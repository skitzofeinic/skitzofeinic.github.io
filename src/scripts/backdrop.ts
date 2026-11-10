/*
 * The animated backdrop, in plain WebGL (no library, so nothing extra to download).
 *
 * It renders in two passes so it stays light:
 * 1. the slow, expensive noise field, at a quarter of the resolution;
 * 2. the cheap full-resolution halftone, which reads that field smoothed back up.
 * The field is soft and large, so computing it at a quarter of the size looks the same
 * and does about a sixteenth of the work.
 */

/* the noise field is computed at 1 / FIELD_SCALE of the screen resolution */
const FIELD_SCALE = 4;
/* the shapes drift so slowly that a low frame rate is invisible and saves battery */
const FRAME_INTERVAL_MS = 100;
/* while the mouse is pushing the shapes along they need a smoother frame rate */
const MOVING_FRAME_INTERVAL_MS = 33;
/* how much extra animation time one full-width sweep of the mouse adds */
const FLOW_PER_SCREEN = 0.05;
/* how far one full-width sweep slides the pattern along with the mouse */
const DRIFT_PER_SCREEN = 0.2;

/* one triangle that covers the whole screen */
const vertexShader = /* glsl */ `
	attribute vec2 aPosition;
	void main() {
		gl_Position = vec4(aPosition, 0.0, 1.0);
	}
`;

const fieldShader = /* glsl */ `
	precision highp float;

	uniform float uTime;
	/* the smaller side of the full screen, so the shapes keep their size at any resolution */
	uniform float uScreenMin;
	/* the full screen width, so the bright blobs can favour the right side */
	uniform float uScreenWidth;
	/* a random offset per visit, so the shapes are arranged differently every time */
	uniform vec2 uSeed;
	/* extra animation time earned by moving the mouse, so the blobs flow while it moves */
	uniform float uFlow;
	/* how far the mouse has pushed the pattern, in the direction it moved */
	uniform vec2 uDrift;

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

	void main() {
		/* back in full-screen pixels, so the shapes match the halftone pass */
		vec2 pixel = gl_FragCoord.xy * ${FIELD_SCALE.toFixed(1)};
		/* subtracting the drift moves the pattern the same way the mouse went */
		vec2 uv = pixel / uScreenMin * 2.8 + uSeed - uDrift;
		/* a slow drift of its own, sped along by the mouse */
		float t = uTime * 0.0006 + uFlow;

		/* warping the noise through itself makes the large, liquid shapes */
		vec2 warp = vec2(fbm(uv + t), fbm(uv - t + 4.0));
		float field = fbm(uv + warp * 1.5 + vec2(t * 0.7, -t * 0.4));

		/*
		 * The offset sets where a bright blob forms. It rises to the right, so whole bright blobs
		 * gather there, away from the text, while the left stays mostly dark.
		 */
		float across = pixel.x / uScreenWidth;
		float offset = 0.03 + 0.08 * smoothstep(0.45, 1.0, across);
		gl_FragColor = vec4(clamp((field - offset) / 0.32, 0.0, 1.0), 0.0, 0.0, 1.0);
	}
`;

const halftoneShader = /* glsl */ `
	precision highp float;

	uniform sampler2D uField;
	uniform vec2 uResolution;
	uniform vec3 uBackground;

	const float SHADOW = 0.6;
	/* how strongly the bright blobs catch the light on the side facing the top left */
	const float SHEEN = 0.25;
	/* and how deep they fall into shadow on the side facing away */
	const float SHADE = 0.9;

	float hash(vec2 p) {
		return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
	}

	void main() {
		vec2 pixel = floor(gl_FragCoord.xy);
		/* the field, smoothed back up from its quarter resolution */
		float shaped = texture2D(uField, gl_FragCoord.xy / uResolution).r;
		/* a little fixed per-pixel noise keeps the edges from looking machine-made */
		shaped = clamp(shaped + (hash(pixel) - 0.5) * 0.06, 0.0, 1.0);

		/*
		 * A two-colour halftone over the whole page, like newspaper print: a diagonal grid of
		 * dark dots on zaffre, tiny in the bright areas and merging into solid dark in the
		 * deepest ones.
		 */
		vec2 grid = (pixel + 0.5) / 3.0;
		vec2 diagonal = vec2(grid.x + grid.y, grid.x - grid.y) * 0.7071;
		float distanceToDot = length(fract(diagonal) - 0.5);
		float radius = 0.1 + 0.62 * shaped * shaped;
		float level = distanceToDot < radius ? 1.0 : 0.0;

		/* deep shadows over the zaffre background */
		vec3 colour = uBackground * (1.0 - level * SHADOW);

		/*
		 * Shading: light falls from the top left. Where the field gets darker towards the light,
		 * this is a bright blob's lit edge, so the zaffre between its dots turns a paler blue;
		 * on the edge facing away it sinks into a deeper blue instead.
		 */
		vec2 uv = gl_FragCoord.xy / uResolution;
		vec2 toLight = vec2(-0.7071, 0.7071) * 16.0 / uResolution;
		float slope = texture2D(uField, uv + toLight).r - texture2D(uField, uv - toLight).r;
		float lit = clamp(slope * 4.0, 0.0, 1.0) * (1.0 - shaped) * (1.0 - level);
		colour = mix(colour, mix(uBackground, vec3(1.0), 0.35), lit * SHEEN);
		/* not capped early like the light, so steep blobs sink deep and gentle ones only a little */
		float shadow = sqrt(clamp(-slope * 1.5, 0.0, 1.0)) * (1.0 - shaped) * (1.0 - level);
		colour = mix(colour, uBackground * 0.25, shadow * SHADE);

		/* faint scanlines: every other row a touch darker */
		colour *= mod(pixel.y, 2.0) < 1.0 ? 0.88 : 1.0;
		gl_FragColor = vec4(colour, 1.0);
	}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error(gl.getShaderInfoLog(shader) ?? "shader did not compile");
	}
	return shader;
}

function program(gl: WebGLRenderingContext, fragment: string) {
	const linked = gl.createProgram()!;
	gl.attachShader(linked, compile(gl, gl.VERTEX_SHADER, vertexShader));
	gl.attachShader(linked, compile(gl, gl.FRAGMENT_SHADER, fragment));
	gl.bindAttribLocation(linked, 0, "aPosition");
	gl.linkProgram(linked);
	if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
		throw new Error(gl.getProgramInfoLog(linked) ?? "program did not link");
	}
	return linked;
}

function startBackdrop(canvas: HTMLCanvasElement) {
	const gl = canvas.getContext("webgl", {
		alpha: false,
		antialias: false,
		depth: false,
		stencil: false,
		powerPreference: "low-power",
	});
	if (!gl) throw new Error("no WebGL");

	const field = program(gl, fieldShader);
	const halftone = program(gl, halftoneShader);
	const at = (linked: WebGLProgram, name: string) => gl.getUniformLocation(linked, name);
	const u = {
		time: at(field, "uTime"),
		screenMin: at(field, "uScreenMin"),
		screenWidth: at(field, "uScreenWidth"),
		seed: at(field, "uSeed"),
		flow: at(field, "uFlow"),
		drift: at(field, "uDrift"),
		fieldTexture: at(halftone, "uField"),
		resolution: at(halftone, "uResolution"),
		background: at(halftone, "uBackground"),
	};

	/* the full-screen triangle, shared by both passes */
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	/* the quarter-resolution field lives in a texture the halftone pass reads from */
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const framebuffer = gl.createFramebuffer();

	/*
	 * The page background colour, read from the CSS so it stays the one source. Read through
	 * an element's computed colour, which is always rgb(): the minified build writes hex.
	 */
	const probe = document.createElement("i");
	probe.style.color = "var(--color-background)";
	document.body.append(probe);
	const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/g) ?? ["0", "0", "170"]).map(Number);
	probe.remove();
	gl.useProgram(halftone);
	gl.uniform3f(u.background, r / 255, g / 255, b / 255);
	gl.uniform1i(u.fieldTexture, 0);
	gl.useProgram(field);
	gl.uniform2f(u.seed, Math.random() * 100, Math.random() * 100);

	let width = 1;
	let height = 1;
	let fieldWidth = 1;
	let fieldHeight = 1;

	const resize = () => {
		/* the canvas's own box, which is taller than innerHeight on phones (see #backdrop) */
		width = Math.ceil(canvas.clientWidth);
		height = Math.ceil(canvas.clientHeight);
		canvas.width = width;
		canvas.height = height;
		fieldWidth = Math.ceil(width / FIELD_SCALE);
		fieldHeight = Math.ceil(height / FIELD_SCALE);

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fieldWidth, fieldHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		gl.useProgram(field);
		gl.uniform1f(u.screenMin, Math.min(width, height));
		gl.uniform1f(u.screenWidth, width);
		gl.useProgram(halftone);
		gl.uniform2f(u.resolution, width, height);
		/* redraw straight away, or the stretched old frame shows until the next tick */
		lastFrame = 0;
	};

	/*
	 * Mouse travel is banked as flow and paid out gradually, so the blobs keep gliding
	 * for a moment after the mouse stops instead of halting with it.
	 */
	let banked = 0;
	/* the same, but as a direction: the pattern slides the way the mouse went */
	let bankedX = 0;
	let bankedY = 0;
	let flow = 0;
	let driftX = 0;
	let driftY = 0;
	let lastPointer: { x: number; y: number } | null = null;

	window.addEventListener(
		"pointermove",
		(e) => {
			if (lastPointer) {
				const dx = (e.clientX - lastPointer.x) / window.innerWidth;
				/* screen y grows downwards, the shader's upwards */
				const dy = -(e.clientY - lastPointer.y) / window.innerWidth;
				banked += Math.hypot(dx, dy) * FLOW_PER_SCREEN;
				bankedX += dx * DRIFT_PER_SCREEN;
				bankedY += dy * DRIFT_PER_SCREEN;
			}
			lastPointer = { x: e.clientX, y: e.clientY };
		},
		{ passive: true },
	);

	let lastFrame = 0;
	window.addEventListener("resize", resize);
	resize();

	const render = (now: number) => {
		requestAnimationFrame(render);
		/* smooth frames while there is movement to pay out, slow frames otherwise */
		const moving = banked > 1e-4 || bankedX * bankedX + bankedY * bankedY > 1e-8;
		const interval = moving ? MOVING_FRAME_INTERVAL_MS : FRAME_INTERVAL_MS;
		if (now - lastFrame < interval) return;
		lastFrame = now;

		const payout = banked * 0.15;
		banked -= payout;
		flow += payout;
		driftX += bankedX * 0.15;
		driftY += bankedY * 0.15;
		bankedX *= 0.85;
		bankedY *= 0.85;

		/* pass 1: the noise field, small */
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.viewport(0, 0, fieldWidth, fieldHeight);
		gl.useProgram(field);
		/* wrapped so shader precision never degrades on a long-open tab */
		gl.uniform1f(u.time, (now / 1000) % 3600);
		gl.uniform1f(u.flow, flow);
		gl.uniform2f(u.drift, driftX, driftY);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		/* pass 2: the halftone, full size, reading the field */
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.useProgram(halftone);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	requestAnimationFrame(render);
}

const canvas = document.getElementById("backdrop") as HTMLCanvasElement | null;

if (canvas) {
	try {
		startBackdrop(canvas);
	} catch {
		/* without WebGL the page simply keeps its plain background and grain */
		canvas.remove();
	}
}

/* marks this file as a module, so the layout can load it with import() */
export {};
