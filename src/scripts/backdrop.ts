import {
	Mesh,
	NoBlending,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";

/* one rendered pixel covers this many CSS pixels, which gives the chunky look */
const CELL_SIZE = 1;
/* the shapes drift so slowly that a low frame rate is invisible and saves battery */
const FRAME_INTERVAL_MS = 100;
/* while the mouse is pushing the shapes along they need a smoother frame rate */
const MOVING_FRAME_INTERVAL_MS = 33;
/* how much extra animation time one full-width sweep of the mouse adds */
const FLOW_PER_SCREEN = 0.05;
/* how far one full-width sweep slides the pattern along with the mouse */
const DRIFT_PER_SCREEN = 0.2;

const vertexShader = /* glsl */ `
	void main() {
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;

const fragmentShader = /* glsl */ `
	uniform float uTime;
	uniform vec2 uResolution;
	uniform vec3 uBackground;
	/* a random offset per visit, so the shapes are arranged differently every time */
	uniform vec2 uSeed;
	/* extra animation time earned by moving the mouse, so the blobs flow while it moves */
	uniform float uFlow;
	/* how far the mouse has pushed the pattern, in the direction it moved */
	uniform vec2 uDrift;

	const float SHADOW = 0.6;

	float hash(vec2 p) {
		return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
	}

	float noise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
			mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
			u.y
		);
	}

	float fbm(vec2 p) {
		float value = 0.0;
		float amplitude = 0.5;
		for (int i = 0; i < 4; i++) {
			value += amplitude * noise(p);
			p *= 2.02;
			amplitude *= 0.5;
		}
		return value;
	}

	/* a 4 by 4 ordered (Bayer) dither threshold, between 0 and 1 */
	float bayer2(vec2 a) {
		a = floor(a);
		return fract(a.x / 2.0 + a.y * a.y * 0.75);
	}

	float bayer4(vec2 a) {
		return bayer2(0.5 * a) * 0.25 + bayer2(a);
	}

	void main() {
		vec2 pixel = floor(gl_FragCoord.xy);
		vec2 cell = pixel;
		/* stretch cells sideways into blocks of mixed width: each stretch of a row picks its own */
		float span = 12.0;
		float choice = hash(vec2(floor(cell.x / span), cell.y) + 3.1);
		float width = choice < 0.3 ? 1.0 : choice < 0.55 ? 2.0 : choice < 0.75 ? 3.0 : choice < 0.9 ? 4.0 : 6.0;
		cell.x = floor(cell.x / span) * span + floor(mod(cell.x, span) / width) * width;
		/* subtracting the drift moves the pattern the same way the mouse went */
		vec2 uv = cell / min(uResolution.x, uResolution.y) * 2.0 + uSeed - uDrift;
		/* a slow drift of its own, sped along by the mouse */
		float t = uTime * 0.0006 + uFlow;

		/* warping the noise through itself makes the large, liquid shapes */
		vec2 warp = vec2(fbm(uv + t), fbm(uv - t + 4.0));
		float field = fbm(uv + warp * 2.2 + vec2(t * 0.7, -t * 0.4));

		/* a little fixed per-cell noise keeps the edges from looking machine-made */
		float roughness = hash(cell) - 0.5;
		float shaped = clamp((field - 0.15) / 0.32 + roughness * 0.06, 0.0, 1.0);
		/*
		 * A two-colour halftone over the whole page, like newspaper print: a diagonal grid of
		 * dark dots on zaffre, tiny in the bright areas and merging into solid dark in the
		 * deepest ones.
		 */
		vec2 grid = (pixel + 0.5) / 4.0;
		vec2 diagonal = vec2(grid.x + grid.y, grid.x - grid.y) * 0.7071;
		float distanceToDot = length(fract(diagonal) - 0.5);
		float radius = 0.1 + 0.62 * shaped * shaped;
		float level = distanceToDot < radius ? 1.0 : 0.0;

		/* deep shadows over the zaffre background */
		vec3 colour = uBackground * (1.0 - level * SHADOW);

		/* faint scanlines: every other row a touch darker */
		colour *= mod(pixel.y, 2.0) < 1.0 ? 0.88 : 1.0;
		gl_FragColor = vec4(colour, 1.0);
	}
`;

function startBackdrop(canvas: HTMLCanvasElement) {
	const renderer = new WebGLRenderer({
		canvas,
		alpha: true,
		antialias: false,
		powerPreference: "low-power",
	});
	renderer.setPixelRatio(1);
	renderer.setClearColor(0x000000, 0);

	const material = new ShaderMaterial({
		vertexShader,
		fragmentShader,
		/* the canvas paints the page background itself, so it is fully opaque */
		blending: NoBlending,
		depthTest: false,
		depthWrite: false,
		uniforms: {
			uTime: { value: 0 },
			uResolution: { value: new Vector2(1, 1) },
			uBackground: { value: new Vector3() },
			uSeed: { value: new Vector2(Math.random() * 100, Math.random() * 100) },
			uFlow: { value: 0 },
			uDrift: { value: new Vector2() },
		},
	});

	const scene = new Scene();
	const quad = new Mesh(new PlaneGeometry(2, 2), material);
	quad.frustumCulled = false;
	scene.add(quad);
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

	const resize = () => {
		const width = Math.ceil(window.innerWidth / CELL_SIZE);
		const height = Math.ceil(window.innerHeight / CELL_SIZE);
		renderer.setSize(width, height, false);
		material.uniforms.uResolution.value.set(width, height);
	};
	window.addEventListener("resize", resize);
	resize();

	/* the page background colour, read from the CSS so it stays the one source */
	const css = getComputedStyle(document.documentElement).getPropertyValue("--color-background");
	const [r, g, b] = (css.match(/\d+/g) ?? ["0", "0", "255"]).map(Number);
	material.uniforms.uBackground.value.set(r / 255, g / 255, b / 255);

	/*
	 * Mouse travel is banked as flow and paid out gradually, so the blobs keep gliding
	 * for a moment after the mouse stops instead of halting with it.
	 */
	let banked = 0;
	/* the same, but as a direction: the pattern slides the way the mouse went */
	const bankedDrift = new Vector2();
	const drift = material.uniforms.uDrift.value as Vector2;
	let lastPointer: { x: number; y: number } | null = null;

	window.addEventListener(
		"pointermove",
		(e) => {
			if (lastPointer) {
				const dx = (e.clientX - lastPointer.x) / window.innerWidth;
				/* screen y grows downwards, the shader's upwards */
				const dy = -(e.clientY - lastPointer.y) / window.innerWidth;
				/* a full sweep across the screen moves the blobs about as far as a minute of drift */
				banked += Math.hypot(dx, dy) * FLOW_PER_SCREEN;
				bankedDrift.x += dx * DRIFT_PER_SCREEN;
				bankedDrift.y += dy * DRIFT_PER_SCREEN;
			}
			lastPointer = { x: e.clientX, y: e.clientY };
		},
		{ passive: true },
	);

	let lastFrame = 0;

	const render = (now: number) => {
		requestAnimationFrame(render);
		/* smooth frames while there is movement to pay out, slow frames otherwise */
		const moving = banked > 1e-4 || bankedDrift.lengthSq() > 1e-8;
		const interval = moving ? MOVING_FRAME_INTERVAL_MS : FRAME_INTERVAL_MS;
		if (now - lastFrame < interval) return;
		lastFrame = now;
		const payout = banked * 0.15;
		banked -= payout;
		material.uniforms.uFlow.value += payout;
		const step = bankedDrift.clone().multiplyScalar(0.15);
		bankedDrift.sub(step);
		drift.add(step);
		/* wrapped so shader precision never degrades on a long-open tab */
		material.uniforms.uTime.value = (now / 1000) % 3600;
		renderer.render(scene, camera);
	};

	requestAnimationFrame(render);
}

const canvas = document.getElementById("backdrop") as HTMLCanvasElement | null;

if (canvas) {
	try {
		startBackdrop(canvas);
	} catch {
		/* without WebGL the page simply keeps its static grain */
		canvas.remove();
	}
}
