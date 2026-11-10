/*
 * Everything that moves on the page, apart from the backdrop (backdrop.ts):
 * snapping between sections, the pixel reveal, the sliding nav, the phone layout and rail,
 * and a few small extras. Sections are `.snap-panel`; on phones they are cut into
 * one-screen pages made of `.snap-step` blocks.
 */

/* ---------- layout modes ---------- */

/* desktop: one section per screen, scrolling inside main */
const snapMode = window.matchMedia("(min-width: 768px) and (min-height: 501px)");
/* phones: sections cut into one-screen pages */
const phoneMode = window.matchMedia("(max-width: 767px) and (min-height: 501px)");
const steppable = () => snapMode.matches || phoneMode.matches;

/* ---------- timings ---------- */

/* the quick slide between sections */
const SLIDE_MS = 260;
/* the pixel reveal: block size, pause before it starts, and how long the sweep takes */
const PIXEL_SIZE = 32;
const PIXEL_HOLD_MS = 450;
const PIXEL_REVEAL_MS = 800;
/* how long a section takes to fade into its peek (matches --peek-fade in the CSS) */
const PEEK_FADE_MS = 400;
/* the nav moves this far per section */
const NAV_STEP_REM = 1.75;

/* ---------- elements ---------- */

const root = document.documentElement;
const header = document.querySelector("header");
const footer = document.querySelector("footer");
const sidebar = document.getElementById("nav-main");
const contentArea = document.querySelector<HTMLElement>(".flex.flex-1");
/* the content scrolls inside main, except on short screens */
const scroller = document.querySelector("main")!;
const streakRail = document.getElementById("nav-streaks");
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".nav-link"));

/* the real sections, in order */
const panels = Array.from(document.querySelectorAll<HTMLElement>(".snap-panel"));

/* ---------- the header's height drives the layout below it ---------- */

function syncHeaderHeight() {
	if (!header) return;
	const height = header.offsetHeight;
	root.style.setProperty("--header-h", `${height}px`);
	if (sidebar) sidebar.style.top = `${height}px`;
	if (contentArea) {
		contentArea.style.paddingTop = getComputedStyle(header).position === "fixed" ? `${height}px` : "";
	}
}

if (header) new ResizeObserver(syncHeaderHeight).observe(header);
syncHeaderHeight();

/* ---------- the loop ---------- */

/*
 * The page loops downwards only: a copy of the first section goes after the last, so it
 * peeks in below contact. Landing on the copy jumps to the real first section in the same
 * spot, which looks the same, so the loop is seamless. Scrolling up at the top does
 * nothing, so the start of the page stays a clear anchor.
 */
function makeLoopCopy(source: HTMLElement) {
	const copy = source.cloneNode(true) as HTMLElement;
	copy.removeAttribute("id");
	copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
	copy.dataset.loopOf = source.id;
	copy.setAttribute("aria-hidden", "true");
	copy.inert = true;
	return copy;
}

if (panels.length > 1) panels[panels.length - 1].after(makeLoopCopy(panels[0]));

/* the real sections plus the loop copy, in page order */
const allPanels = Array.from(document.querySelectorAll<HTMLElement>(".snap-panel"));
const steps = Array.from(document.querySelectorAll<HTMLElement>(".snap-step"));

/* the real section a step, page or loop copy belongs to */
function sectionOf(target: HTMLElement) {
	const section = target.closest<HTMLElement>(".snap-panel") ?? target;
	const real = section.dataset.loopOf ? document.getElementById(section.dataset.loopOf) : null;
	return real ?? section;
}

/* ---------- where are we ---------- */

function atScrollEnd() {
	if (getComputedStyle(scroller).position === "fixed") {
		return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
	}
	return window.innerHeight + window.scrollY >= root.scrollHeight - 2;
}

function currentIn(targets: HTMLElement[]) {
	if (atScrollEnd()) return targets[targets.length - 1];

	/* phone screens can hold several sections, so look further down */
	const line = window.innerHeight * (window.innerWidth < 768 ? 0.6 : 1 / 3);
	let current = targets[0];
	for (const target of targets) {
		if (target.getBoundingClientRect().top <= line) current = target;
	}
	return current;
}

const currentPanel = () => currentIn(panels);

/* ---------- the nav, the phone rail and "current" ---------- */

/* the phone screens the rail was last built from (set by buildStreaks) */
let streakPages: HTMLElement[] = [];
let streaks: HTMLElement[] = [];
/* where a slide is heading, so the nav can move there at once instead of trailing the page */
let navTarget: HTMLElement | null = null;
/* what the nav last showed, so a scroll frame that changes nothing touches nothing */
let shownPanel: HTMLElement | null = null;
let shownPage: HTMLElement | null = null;

/*
 * Phones: one tick per screen, grouped per section, so a section that takes two screens
 * shows two ticks. Elsewhere one tick per section.
 */
function buildStreaks(phonePages: HTMLElement[]) {
	if (!streakRail) return;
	streakRail.replaceChildren();
	streakPages = phonePages;

	for (const panel of panels) {
		const group = document.createElement("div");
		group.className = "streak-group";
		const ownPages = phonePages.filter((page) => page.closest(".snap-panel") === panel);
		const targets = ownPages.length ? ownPages : [panel];
		const name = navLinks.find((link) => link.hash === `#${panel.id}`)?.textContent ?? panel.id;

		targets.forEach((target, i) => {
			const link = document.createElement("a");
			link.href = `#${panel.id}`;
			link.className = "streak";
			link.dataset.page = String(phonePages.indexOf(target));
			link.setAttribute("aria-label", targets.length > 1 ? `${name}, part ${i + 1} of ${targets.length}` : name);
			group.append(link);
		});
		streakRail.append(group);
	}
	streaks = Array.from(streakRail.querySelectorAll<HTMLElement>(".streak"));
	setActiveNav(true);
}

/* runs on every scroll frame, so it only touches the page when something changed */
function setActiveNav(force = false) {
	const panel = navTarget ? sectionOf(navTarget) : currentPanel();
	const page = streakPages.length ? currentIn(streakPages) : null;
	if (!force && panel === shownPanel && page === shownPage) return;
	shownPanel = panel;
	shownPage = page;
	const hash = `#${panel.id}`;

	/* the contact section shows the same links as tiles, so the footer ones step aside there */
	root.classList.toggle("quick-links-visible", panel.id === "contact");

	/*
	 * Lets a section animate things (like the score bars) and drop its peek fade once it is
	 * current. The loop copy counts as its real section, or it would stay faded while you
	 * slide into it.
	 */
	allPanels.forEach((other) =>
		other.classList.toggle("is-current", other === panel || other.dataset.loopOf === panel.id),
	);

	/* the nav is a list in page order that slides so the current item stays in the middle */
	const current = navLinks.findIndex((link) => link.hash === hash);
	navLinks.forEach((link, i) => {
		const active = i === current;
		link.classList.toggle("active", active);
		if (active) link.setAttribute("aria-current", "location");
		else link.removeAttribute("aria-current");
		(link.parentElement as HTMLElement).style.transform = `translateY(${(i - current) * NAV_STEP_REM}rem)`;
	});

	/* the rail: the current screen bright, the rest of its section half-bright */
	for (const streak of streaks) {
		const inSection = streak.getAttribute("href") === hash;
		streak.classList.toggle("in-section", inSection);
		streak.classList.toggle("active", page ? streakPages[Number(streak.dataset.page)] === page : inSection);
	}
}

/* ---------- the pixel reveal ---------- */

type PixelCell = { x: number; y: number; until: number };

let pixelFrame = 0;
/* the section being revealed, and the scroll position its blocks line up with */
let revealing: HTMLElement | null = null;
let revealTop = 0;

/*
 * One grid cell per block of text in the panel, in the positions the panel will have once it
 * has slid into place. `shift` is how far the content still has to move up.
 */
function collectPixelCells(panel: HTMLElement, area: DOMRect, direction: number, shift: number) {
	const cells = new Map<string, PixelCell>();
	const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	const finalTop = area.top + shift;

	const cover = (rect: DOMRect) => {
		const right = rect.right - area.left;
		const bottom = rect.bottom - finalTop;
		const startX = Math.floor((rect.left - area.left) / PIXEL_SIZE) * PIXEL_SIZE;
		const startY = Math.floor((rect.top - finalTop) / PIXEL_SIZE) * PIXEL_SIZE;
		for (let y = startY; y < bottom; y += PIXEL_SIZE) {
			for (let x = startX; x < right; x += PIXEL_SIZE) {
				const key = `${x},${y}`;
				if (!cells.has(key)) cells.set(key, { x, y, until: 0 });
			}
		}
	};

	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		if (!node.data.trim()) continue;
		range.selectNodeContents(node);
		Array.from(range.getClientRects()).forEach(cover);
	}

	/* lines and boxes too, so the panel is completely empty during the hold */
	panel
		.querySelectorAll("hr, .skill-row, .entry, .project-card, .contact-tile")
		.forEach((element) => cover(element.getBoundingClientRect()));

	/*
	 * Whatever already peeked in before the slide stays visible; only what was off screen is
	 * revealed. Judged by each block's centre at its old position.
	 */
	const fresh = Array.from(cells.values()).filter((cell) => {
		const centre = cell.y + shift + PIXEL_SIZE / 2;
		return shift === 0 || centre < 0 || centre >= area.height;
	});
	const continuing = fresh.length < cells.size;

	/* spread over the new content's own height, so the sweep starts right where the peek ended */
	const ys = fresh.map((cell) => cell.y);
	const top = Math.min(...ys);
	const span = Math.max(Math.max(...ys) - top, 1);
	/*
	 * Carrying on from a peek only waits for the slide to land. Stepping back up waits for the
	 * section below to fade into its peek first. The full pause is for the first load and for
	 * jumps from the nav.
	 */
	const hold = continuing ? SLIDE_MS : direction < 0 ? PEEK_FADE_MS + 50 : PIXEL_HOLD_MS;

	for (const cell of fresh) {
		/* follows the scroll: top down when going down, bottom up when going up */
		const along = (cell.y - top) / span;
		const order = direction < 0 ? 1 - along : along;
		cell.until = hold + (order * 0.7 + Math.random() * 0.3) * PIXEL_REVEAL_MS;
	}
	return fresh;
}

/*
 * While a section reveals, every section that is not fully revealed stays hidden: ones the
 * page slides past on a fast scroll, and a previous target cut off halfway. Only the section
 * you came from (if it had finished) and the one you are going to show. When the reveal ends,
 * all are shown again, so the next section can peek in below.
 */
function hideAllBut(keep: Set<HTMLElement>) {
	allPanels.forEach((section) => section.classList.toggle("veiled", !keep.has(section)));
}

function showAll() {
	revealing = null;
	allPanels.forEach((section) => section.classList.remove("veiled"));
}

/*
 * Clips blocks out of the content itself, so the backdrop stays untouched. While the panel is
 * still sliding into place the blocks ride along with it.
 */
function revealPanelText(panel: HTMLElement, direction = 1, targetTop?: number) {
	cancelAnimationFrame(pixelFrame);
	scroller.style.clipPath = "";

	if (!snapMode.matches) {
		showAll();
		return;
	}

	const section = panel.closest<HTMLElement>(".snap-panel") ?? panel;
	const keep = new Set([section]);
	/* the section you leave stays; going up it becomes the peek below, even if cut off mid-reveal */
	if (!revealing || direction < 0) keep.add(revealing ?? currentIn(allPanels));
	hideAllBut(keep);
	revealing = section;

	const area = scroller.getBoundingClientRect();
	revealTop = targetTop ?? scroller.scrollTop;
	const cells = collectPixelCells(panel, area, direction, revealTop - scroller.scrollTop);
	const start = performance.now();
	const visibleArea = `M0 0H${Math.ceil(area.width)}V${Math.ceil(area.height)}H0Z`;

	const draw = (now: number) => {
		const elapsed = now - start;
		/* how far the content still has to slide */
		const offset = Math.round(revealTop - scroller.scrollTop);
		let hidden = "";
		for (const cell of cells) {
			if (elapsed < cell.until) {
				hidden += `M${cell.x} ${cell.y + offset}h${PIXEL_SIZE}v${PIXEL_SIZE}h-${PIXEL_SIZE}z`;
			}
		}

		if (hidden) {
			/* even-odd turns each block into a hole in the visible area */
			scroller.style.clipPath = `path(evenodd, "${visibleArea}${hidden}")`;
			pixelFrame = requestAnimationFrame(draw);
		} else {
			scroller.style.clipPath = "";
			showAll();
		}
	};

	/* applied synchronously so the real text never flashes first */
	draw(start);
}

/* ---------- sliding between sections ---------- */

let slideFrame = 0;
/* where an unfinished slide is heading, so fast scrolling keeps counting from there */
let slideTarget: HTMLElement | null = null;

/* if the loop copy fills most of the view, swap to the real section in the same spot */
function leaveLoopCopy() {
	const area = scroller.getBoundingClientRect();
	for (const copy of allPanels) {
		if (!copy.dataset.loopOf) continue;
		const rect = copy.getBoundingClientRect();
		const visible = Math.min(rect.bottom, area.bottom) - Math.max(rect.top, area.top);
		if (visible < area.height / 2) continue;

		const real = document.getElementById(copy.dataset.loopOf);
		if (!real) return;
		scroller.style.scrollSnapType = "none";
		const jump = real.getBoundingClientRect().top - rect.top;
		scroller.scrollTop += jump;
		/* the reveal aims at a scroll position; move that along with the jump */
		revealTop += jump;
		scroller.style.scrollSnapType = "";

		/*
		 * Hand over whatever the copy was showing: the real section appears at once in its
		 * place (no fade), and a reveal still running carries on over it.
		 */
		if (!copy.classList.contains("veiled")) {
			real.style.transition = "none";
			real.classList.remove("veiled");
			void real.offsetHeight;
			real.style.transition = "";
			copy.classList.add("veiled");
		}
		if (revealing === copy) revealing = real;
		return;
	}
}

/* swipes and trackpads scroll natively, so check once they come to rest */
scroller.addEventListener("scrollend", () => {
	if (!slideTarget) leaveLoopCopy();
});

/* where a section snaps to, counting its scroll margin */
function snapTopOf(target: HTMLElement) {
	const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
	return Math.round(
		scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin,
	);
}

function slideTo(top: number) {
	cancelAnimationFrame(slideFrame);
	const from = scroller.scrollTop;
	const start = performance.now();
	/* snapping would pull every intermediate step back to a panel edge */
	scroller.style.scrollSnapType = "none";

	const frame = (now: number) => {
		const t = Math.min((now - start) / SLIDE_MS, 1);
		const eased = 1 - Math.pow(1 - t, 3);
		scroller.scrollTop = from + (top - from) * eased;

		if (t < 1) {
			slideFrame = requestAnimationFrame(frame);
		} else {
			scroller.style.scrollSnapType = "";
			slideTarget = null;
			navTarget = null;
			leaveLoopCopy();
		}
	};
	slideFrame = requestAnimationFrame(frame);
}

function goToPanel(panel: HTMLElement) {
	/* also works for phone pages, which sit in document order too */
	const from = slideTarget ?? currentIn(phoneMode.matches ? pages : allPanels);
	const direction = from.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_PRECEDING ? -1 : 1;
	const top = snapTopOf(panel);

	slideTarget = panel;
	navTarget = panel;
	setActiveNav();
	/*
	 * The slide is scheduled first so that in every frame the content moves before the reveal
	 * places its blocks; the other way round the blocks trail a frame behind and slivers of
	 * text flicker through, which shows when scrolling up.
	 */
	slideTo(top);
	revealPanelText(panel, direction, top);
}

/* ---------- phones: one-screen pages ---------- */

/* first block of each one-screen page in phone mode */
let pages: HTMLElement[] = [];
let pagesLaidOutFor = "";

function stableViewportHeight() {
	const probe = document.createElement("div");
	probe.style.cssText = "position:absolute;visibility:hidden;height:100svh";
	document.body.append(probe);
	const height = probe.offsetHeight;
	probe.remove();
	return height;
}

/* greedily fits as many blocks as possible on each screen */
function layoutPhonePages() {
	steps.forEach((step) => {
		step.classList.remove("page-start");
		step.style.minHeight = "";
		step.style.marginBottom = "";
	});
	pages = [];

	if (!phoneMode.matches) {
		buildStreaks([]);
		return;
	}

	const available = stableViewportHeight() - (header?.offsetHeight ?? 0) - (footer?.offsetHeight ?? 0);
	const height = (step: HTMLElement) => step.getBoundingClientRect().height;

	/* each screen stops short by this much, so the next one peeks in */
	const styles = getComputedStyle(root);
	const peek = parseFloat(styles.getPropertyValue("--peek")) * parseFloat(styles.fontSize);
	const room = available - peek;

	let used = Infinity;
	let last: HTMLElement | null = null;

	/*
	 * Pads a screen out with empty space below its last block, so the next one starts on a
	 * fresh screen. Space, not height: a taller block would stretch its own hover highlight
	 * over the whole screen.
	 */
	const fillLastBlock = (to: number) => {
		if (last && used < to) last.style.marginBottom = `${to - used}px`;
	};

	for (const step of steps) {
		/* a new section always starts on its own screen, and so do the skills */
		const newSection = last?.closest(".snap-panel") !== step.closest(".snap-panel");
		const startsPage = newSection || step.classList.contains("skills-heading");

		if (startsPage || used + height(step) > room) {
			/*
			 * Only a screen that ends a section (or comes before the skills) is padded out, so
			 * the next one starts clean. Otherwise the next screen follows on.
			 */
			if (startsPage) fillLastBlock(room);
			step.classList.add("page-start");
			pages.push(step);
			used = height(step);
		} else {
			used += height(step);
		}
		last = step;
	}

	/* nothing comes after the last screen, so it fills all the way down; height here, not
	   space, because space after the very last block may not count as scrollable */
	if (last && used < available) last.style.minHeight = `${height(last) + available - used}px`;
	buildStreaks(pages);
}

function relayoutPhonePages() {
	/* mobile browser bars resize the window while scrolling; ignore those */
	const key = `${window.innerWidth}x${stableViewportHeight()}`;
	if (key === pagesLaidOutFor) return;
	pagesLaidOutFor = key;
	layoutPhonePages();
}

function pageBottom(page: HTMLElement) {
	const next = pages[pages.indexOf(page) + 1];
	return next ? next.getBoundingClientRect().top : steps[steps.length - 1].getBoundingClientRect().bottom;
}

function pageContaining(panel: HTMLElement) {
	const index = steps.indexOf(panel.querySelector<HTMLElement>(".snap-step")!);
	return pages.reduce((found, page) => (steps.indexOf(page) <= index ? page : found));
}

/* ---------- stepping: wheel, keys ---------- */

function stepPanel(direction: number) {
	/* the loop copy counts as a step too, so the slide carries on round to the start */
	const targets = phoneMode.matches ? pages : allPanels;

	/* mid-slide: count from where the slide is going, not from where it is */
	if (slideTarget && targets.includes(slideTarget)) {
		const next = targets[targets.indexOf(slideTarget) + direction];
		if (next) goToPanel(next);
		return;
	}

	const panel = currentIn(targets);
	/*
	 * Measure the content itself, not the section box: the box has padding, and empty padding
	 * below the view must not cost an extra scroll.
	 */
	const contentRange = document.createRange();
	contentRange.selectNodeContents(panel);
	const content = contentRange.getBoundingClientRect();
	const bottom = phoneMode.matches ? pageBottom(panel) : content.bottom;
	const area = scroller.getBoundingClientRect();
	const hidden = direction > 0 ? bottom - area.bottom : area.top - content.top;

	/* only reachable on very short windows where a panel overflows */
	if (hidden > 2) {
		scroller.scrollBy({ top: direction * Math.min(hidden, area.height * 0.9), behavior: "instant" });
		return;
	}

	const next = targets[targets.indexOf(panel) + direction];
	if (next) goToPanel(next);
}

/*
 * Every mouse-wheel notch moves one panel immediately. A trackpad sends a long stream of
 * events per swipe: a ramp up, then a fading momentum tail. One step per stream, but once
 * the tail has faded to half its peak, a delta that jumps back up (or turns around) is a
 * new swipe, so it steps without waiting for the tail to end.
 */
const WHEEL_NOTCH = 120;
const TRACKPAD_QUIET_MS = 120;
/* deltas this small are finger jitter, e.g. on lift-off, never a swipe */
const TRACKPAD_JITTER = 4;
let trackpadActive = false;
let trackpadRelease = 0;
let lastTrackpadDelta = 0;
let lastTrackpadStep = 0;
let trackpadPeak = 0;
let trackpadFaded = false;

window.addEventListener(
	"wheel",
	(e) => {
		if (!steppable() || e.ctrlKey || e.deltaY === 0) return;
		e.preventDefault();

		const direction = Math.sign(e.deltaY);
		const legacyDelta = (e as unknown as { wheelDeltaY: number }).wheelDeltaY;
		if (legacyDelta !== 0 && legacyDelta % WHEEL_NOTCH === 0) {
			stepPanel(direction);
			return;
		}

		clearTimeout(trackpadRelease);
		trackpadRelease = window.setTimeout(() => (trackpadActive = false), TRACKPAD_QUIET_MS);
		const now = performance.now();
		const size = Math.abs(e.deltaY);
		const newSwipe =
			now - lastTrackpadStep > SLIDE_MS &&
			size > TRACKPAD_JITTER &&
			(Math.sign(e.deltaY) !== Math.sign(lastTrackpadDelta) ||
				(trackpadFaded && size > Math.abs(lastTrackpadDelta) * 1.5 + TRACKPAD_JITTER));
		lastTrackpadDelta = e.deltaY;
		if (!trackpadActive || newSwipe) {
			trackpadActive = true;
			lastTrackpadStep = now;
			trackpadPeak = size;
			trackpadFaded = false;
			stepPanel(direction);
		} else {
			trackpadPeak = Math.max(trackpadPeak, size);
			if (size < trackpadPeak / 2) trackpadFaded = true;
		}
	},
	{ passive: false },
);

/* main is not focused by default, so step through panels from the page */
const STEP_KEYS: Record<string, number> = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 };

window.addEventListener("keydown", (e) => {
	const direction = STEP_KEYS[e.key];
	if (!direction || !steppable() || e.ctrlKey || e.altKey || e.metaKey) return;
	if (e.key === " " && (e.target as Element).closest("a, button")) return;
	e.preventDefault();
	stepPanel(e.key === " " && e.shiftKey ? -1 : direction);
});

/* ---------- phones: settle on the nearest page if a swipe stops between two ---------- */

const SETTLE_DELAY_MS = 150;
let touching = false;
let settleTimer = 0;

function settleOnStep() {
	if (touching || !phoneMode.matches || !pages.length) return;

	const viewTop = header?.offsetHeight ?? 0;
	const viewBottom = window.innerHeight - (footer?.offsetHeight ?? 0);
	const distance = (step: HTMLElement) => Math.abs(step.getBoundingClientRect().top - viewTop);
	const nearest = pages.reduce((a, b) => (distance(b) < distance(a) ? b : a));

	/* a page taller than the screen must stay freely scrollable */
	const overflows = pageBottom(nearest) - nearest.getBoundingClientRect().top > viewBottom - viewTop + 2;
	if (distance(nearest) > 3 && !overflows) nearest.scrollIntoView({ block: "start", behavior: "smooth" });
}

function scheduleSettle() {
	clearTimeout(settleTimer);
	settleTimer = window.setTimeout(settleOnStep, SETTLE_DELAY_MS);
}

const endTouch = () => {
	touching = false;
	scheduleSettle();
};
window.addEventListener("touchstart", () => (touching = true), { passive: true });
window.addEventListener("touchend", endTouch, { passive: true });
window.addEventListener("touchcancel", endTouch, { passive: true });

/* ---------- one scroll listener and one resize listener for everything ---------- */

let scrollFrame = 0;
window.addEventListener(
	"scroll",
	() => {
		cancelAnimationFrame(scrollFrame);
		scrollFrame = requestAnimationFrame(() => setActiveNav());
		if (phoneMode.matches) scheduleSettle();
	},
	/* capture, because scrolling inside main does not bubble */
	{ passive: true, capture: true },
);

let resizeFrame = 0;
window.addEventListener("resize", () => {
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => {
		scaleTimelines();
		relayoutPhonePages();
		setActiveNav(true);
	});
});

/* ---------- links that jump to a section ---------- */

navLinks.forEach((link) => {
	link.addEventListener("click", (e) => {
		if (!steppable()) return;
		const panel = document.querySelector<HTMLElement>(link.hash);
		if (!panel) return;
		e.preventDefault();
		goToPanel(phoneMode.matches ? pageContaining(panel) : panel);
	});
});

/* the rail's ticks are rebuilt with the layout, so one listener handles them all */
streakRail?.addEventListener("click", (e) => {
	const link = (e.target as Element).closest<HTMLAnchorElement>("a.streak");
	if (!link || !steppable()) return;
	const page = streakPages[Number(link.dataset.page)];
	const target = page ?? document.querySelector<HTMLElement>(link.hash);
	if (!target) return;
	e.preventDefault();
	goToPanel(target);
});

/* ---------- small extras ---------- */

/*
 * Score bars: split the filled part into small blocks, each switching on at a time set by its
 * position plus a little randomness, for a ragged left-to-right reveal.
 */
const BAR_BLOCK_PERCENT = 2;
document.querySelectorAll<HTMLElement>(".model-bar").forEach((bar) => {
	const score = parseFloat(bar.style.getPropertyValue("--score"));
	const blocks = document.createDocumentFragment();
	for (let left = 0; left < score; left += BAR_BLOCK_PERCENT) {
		const block = document.createElement("span");
		block.className = "bar-block";
		block.style.setProperty("--left", `${left}%`);
		block.style.setProperty("--width", `${Math.min(BAR_BLOCK_PERCENT, score - left)}%`);
		block.style.setProperty("--delay", `${Math.round(300 + (left / 100) * 700 + Math.random() * 160)}ms`);
		blocks.append(block);
	}
	bar.append(blocks);
});

/*
 * Each timeline is scaled on its own: its longest entry gets a set height and the rest are
 * sized relative to it, so short jobs and long studies both read clearly.
 */
const timelines = Array.from(document.querySelectorAll<HTMLElement>(".timeline"));
function scaleTimelines() {
	const longest = Math.min(220, Math.max(120, scroller.clientHeight * 0.3));
	for (const timeline of timelines) {
		const months = Array.from(
			timeline.querySelectorAll<HTMLElement>(".entry"),
			(entry) => parseFloat(entry.style.getPropertyValue("--months")) || 0,
		);
		const most = Math.max(...months);
		if (most > 0) timeline.style.setProperty("--month", `${longest / most}px`);
	}
}
scaleTimelines();

/* the footer clock: Amsterdam time, whatever the visitor's own zone */
const localTime = document.getElementById("local-time");
if (localTime) {
	const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });
	const tick = () => (localTime.textContent = clock.format(new Date()));
	tick();
	setInterval(tick, 15000);
}

/* copy buttons: copy their text, then say so for a moment */
document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
	button.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(button.dataset.copy ?? "");
			button.textContent = "copied";
			button.classList.add("copied");
		} catch {
			button.textContent = "press ctrl+c";
		}
		setTimeout(() => {
			button.textContent = "copy";
			button.classList.remove("copied");
		}, 1600);
	});
});

/* the header's morse line turns into a cat if you type "catto" (escape turns it back) */
const morse = document.getElementById("morse");
if (morse) {
	const originalText = morse.textContent ?? "";
	const secret = "catto";
	let typed = "";
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			morse.textContent = originalText;
			typed = "";
			return;
		}
		if (e.key.length !== 1) return;
		typed = (typed + e.key.toLowerCase()).slice(-20);
		if (typed.includes(secret)) {
			morse.innerHTML = `<span class="cat-animate"><span class="cat-thumb">ദ്ദി</span>（• ˕ •マ.ᐟ</span>`;
			typed = "";
		}
	});
}

/* ---------- start ---------- */

layoutPhonePages();
pagesLaidOutFor = `${window.innerWidth}x${stableViewportHeight()}`;
setActiveNav(true);

/* wait for the web fonts (or 0.8s at most), since they change how tall everything is */
Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 800))]).then(() => {
	layoutPhonePages();
	/*
	 * Start on the section in the link (the browser jumped before the loop copy was added,
	 * which can shift things). Phones snap to steps, so aim at the step there.
	 */
	if (steppable()) {
		const linked = location.hash ? document.querySelector<HTMLElement>(location.hash) : null;
		if (linked?.classList.contains("snap-panel")) {
			scroller.scrollTop = snapTopOf(phoneMode.matches ? pageContaining(linked) : linked);
		}
	}
	setActiveNav(true);
	if (snapMode.matches) revealPanelText(currentPanel());
	root.classList.remove("pixel-pending");
});
