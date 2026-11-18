// The listening session: the one owner of what the page hears. It holds the host's microphone, the guest's shared
// tab, the speech engine (the model on this computer in its worker, or the browser's own speech service) and the
// rules between them: no tab for a guest who said no, a solo show, OBS or the browser's service; Stop lets both
// sources go and Listen asks for the tab again; an answer from the browser that comes after Stop, No or a newer ask is
// let go; End & report lets everything go, also a microphone granted after it. The browser's pieces (the microphone and
// tab picker, the audio tap, the speech worker, the speech service) are passed in, so checks can drive it with fakes.
// The page only draws its view and passes on what it hears. Nothing is kept: sound goes to the speech worker under
// its source's label ("host", "guest"), never mixed, and is dropped there; only text comes back.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).
import { loudness, meterFill, tabButton } from "./listen.mjs";
import { createBrowserSpeech } from "./web-speech.mjs";

/** What the microphone is asked for: one channel, with the browser's echo, noise and level care for a voice. */
const MIC_ASK = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };

// A tiny, slow picture: only the sound is wanted, and a small picture keeps the work on the studio's own tab low. Only a
// browser tab is offered (not a window or a screen, whose sound can be the whole computer's), and no echo processing,
// which is made for a microphone.
const TAB_ASK = {
  video: { frameRate: { ideal: 2 }, width: { ideal: 320 }, height: { ideal: 180 } },
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  systemAudio: "exclude",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "exclude",
  monitorTypeSurfaces: "exclude",
};

/**
 * createListening({ media, openTap, newWorker, Recognition, createService, features, stream, onChange, onLevel, onText,
 * onPause, onFail })
 * - media: the browser's mediaDevices (getUserMedia, getDisplayMedia); openTap(getStream, onChunk) of src/audio-tap.mjs;
 *   newWorker() starts the speech model's worker; Recognition is the browser's SpeechRecognition class, which
 *   createService (createBrowserSpeech of src/web-speech.mjs) wraps.
 * - features: { tabSound, webSpeech } of src/browser.mjs; stream() is the way of streaming picked in "I stream with".
 * - onChange(view) after every change; onLevel(source, fill) moves a level meter; onText(piece) and onPause(source, at)
 *   are what either engine heard, each labelled with its source; onFail(engine, reason) says an engine failed
 *   ("local" the model, "browser" the service) before the session falls back, so the page can bring the setup back.
 *
 * The presses and answers: answerGuest(answer), streamChanged(), pressMic(), pressTab(), loadModel(),
 * pickEngine(engine), open() (Open producer screen), pressListen() (Stop or Listen), stop() (the microphone off, and
 * listening with it), end() (End & report). view() is the state to draw; tabView() is the tab button's words.
 */
export function createListening({ media, openTap, newWorker, Recognition, createService = createBrowserSpeech, features, stream = () => "", onChange = () => {}, onLevel = () => {}, onText = () => {}, onPause = () => {}, onFail = () => {} }) {
  // engine: "local" is the speech model on this computer, "browser" the browser's own speech service (opt-in; its
  // sound goes to the browser maker's service). With the service only the host's microphone is heard: the guest's tab
  // is never sent to it, because the guest agreed to being turned into text on this computer.
  const s = {
    guest: null,
    mic: false,
    micBusy: false,
    micError: "",
    tab: false,
    tabPhase: "idle", // "idle", "busy" while the browser's picker is open, "on", "error" (with tabFailure)
    tabFailure: "",
    listening: false,
    engine: "local",
    listen: { phase: "idle", error: "" }, // the Listen press: "busy" while the browser asks, "error" with the reason
    model: { phase: "idle", percent: 0, reason: "" }, // the model on this computer: idle, loading, ready or error
    serviceFailure: "", // why the browser's service last failed, until it is picked again
  };
  let micTap = null;
  let tabTap = null;
  let worker = null;
  let localReady = false;
  let ended = false;
  // Numbers each ask for a tab: an answer that comes after Stop, No or a newer ask is let go, not kept.
  let shareRun = 0;
  // Set when the tab was shared and listening ended (Stop, or the tab itself ended): Listen then asks for the tab again.
  let tabWanted = false;
  let listenPress = 0;

  /** The picked engine is ready to turn the microphone into text. */
  const speechReady = () => s.engine === "browser" || localReady;
  const tabView = () => tabButton({ feature: features.tabSound, guest: s.guest, phase: s.tabPhase, problem: s.tabFailure, stream: stream(), engine: s.engine });
  const view = () => ({ ...s, listen: { ...s.listen }, model: { ...s.model }, speech: speechReady() });

  // Changes are told once, when the outermost press or event is done.
  let depth = 0;
  function act(fn) {
    depth++;
    try {
      return fn();
    } finally {
      if (--depth === 0) onChange(view());
    }
  }

  const service = createService({
    Recognition,
    onText: (piece) => onText({ ...piece, source: "host" }),
    // About 1.5 s after the last words, as the model's worker reports one: the agent's cues go at pauses.
    onPause: (at) => onPause("host", at),
    onFail: (reason) => act(() => {
      s.serviceFailure = reason;
      onFail("browser", reason);
      pickEngine("local");
    }),
  });

  /** One chunk of a source's sound: its meter moves, and while the model listens the worker gets it. */
  function heard(source, samples, rate) {
    onLevel(source, meterFill(loudness(samples)));
    if (s.listening && s.engine === "local" && worker) worker.postMessage({ type: "audio", source, samples, rate }, [samples.buffer]);
  }

  async function micOn() {
    const tap = await openTap(() => media.getUserMedia(MIC_ASK), (samples, rate) => heard("host", samples, rate));
    micTap = tap;
    // The microphone can also end on its own (unplugged, or the permission taken back): it is shown at once.
    for (const track of tap.stream.getAudioTracks()) track.addEventListener("ended", () => { if (micTap === tap) act(micOff); });
  }

  function micOff() {
    if (!micTap) return;
    micTap.close();
    micTap = null;
    worker?.postMessage({ type: "stop", source: "host" });
    service.stop();
    s.mic = false;
    s.micError = "";
    // Without the host's microphone nothing is listened to: listening stops and the guest tab goes with it. Listen
    // asks for both again (the browser asks the host to pick the tab again each time).
    if (s.listening) {
      s.listening = false;
      tabWanted = tabWanted || s.tab;
      tabOff();
    }
  }

  /** The browser's tab picker; a window, a screen or a tab without sound is let go and refused. */
  async function pickTab() {
    const sound = await media.getDisplayMedia(TAB_ASK);
    const refuse = (name) => {
      for (const track of sound.getTracks()) track.stop();
      throw Object.assign(new Error(name), { name });
    };
    const surface = sound.getVideoTracks()[0]?.getSettings?.().displaySurface;
    if (surface && surface !== "browser") refuse("NotATab");
    if (!sound.getAudioTracks().length) refuse("NoTabSound");
    return sound;
  }

  async function tabOn() {
    const tap = await openTap(pickTab, (samples, rate) => heard("guest", samples, rate));
    // Sharing can end from the browser's own bar or when the tab closes: it is shown at once. If it ends while
    // listening, Listen asks again.
    for (const track of tap.stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (tabTap !== tap) return;
        act(() => {
          const was = s.listening;
          tabOff();
          tabWanted = was;
        });
      });
    }
    return tap;
  }

  /** Asks the browser for the tab; the outcome shows in the view. It never throws. */
  async function shareTab() {
    const run = ++shareRun;
    act(() => { s.tabPhase = "busy"; });
    try {
      const tap = await tabOn();
      act(() => {
        if (run !== shareRun || tabView().off) {
          // Stop, "No", "Solo show" or a newer ask came while the browser was asking: what it hands over is let go.
          tap.close();
          if (run === shareRun) s.tabPhase = "idle";
        } else {
          tabTap = tap;
          s.tab = true;
          tabWanted = false;
          s.tabPhase = "on";
        }
      });
    } catch (error) {
      if (run !== shareRun) return;
      act(() => {
        s.tab = false;
        s.tabPhase = "error";
        s.tabFailure = error?.name || "";
      });
    }
  }

  function tabOff() {
    shareRun++;
    if (tabTap) {
      tabTap.close();
      tabTap = null;
      worker?.postMessage({ type: "stop", source: "guest" });
    }
    s.tab = false;
    s.tabPhase = "idle";
    s.tabFailure = "";
  }

  /** A tab can no longer be heard (the guest's answer, OBS, the browser's service): a shared or asked-for tab stops. */
  function dropTab(whenBusy) {
    tabWanted = false;
    if (s.tab || (whenBusy ? s.tabPhase === "busy" : s.tabPhase !== "idle")) tabOff();
  }

  /** Listening needs the microphone and the picked engine; with the model the tab joins whenever it is shared. */
  function startListening() {
    s.listening = Boolean(micTap && speechReady() && (s.engine === "browser" || worker));
    if (s.listening && s.engine === "browser") service.start(micTap.stream.getAudioTracks()[0]);
  }

  function pickEngine(engine) {
    if (engine === "browser" && !features.webSpeech.on) engine = "local";
    if (engine === "browser") s.serviceFailure = "";
    s.engine = engine;
    if (engine === "local") service.stop();
    // The service hears only the host's microphone, so a shared guest tab is let go (the tab button says why).
    if (engine === "browser") dropTab(false);
  }

  function fromWorker(w, data) {
    if (w !== worker) return; // an ended worker's last words are let go
    if (data.type === "progress") {
      act(() => { s.model = { phase: "loading", percent: Math.floor((data.loaded / data.total) * 100), reason: "" }; });
    } else if (data.type === "ready") {
      act(() => {
        localReady = true;
        s.model = { phase: "ready", percent: 100, reason: "" };
      });
    } else if (data.type === "error") {
      act(() => {
        // The page hears it first (on the producer screen it stops the microphone and brings the setup back), then the
        // worker ends and the model can be loaded again.
        onFail("local", data.reason);
        worker.terminate();
        worker = null;
        localReady = false;
        s.model = { phase: "error", percent: 0, reason: data.reason };
      });
    } else if (data.type === "text") {
      onText(data);
    } else if (data.type === "pause") {
      onPause(data.source, data.at);
    }
  }

  return {
    view,
    tabView,
    /** The host's own answer for the guest. A guest who said no, or a solo show, is never listened to. */
    answerGuest: (answer) => act(() => {
      s.guest = answer;
      if (answer !== "yes") dropTab(true);
    }),
    /** Step 1 changed: OBS has no studio tab, so a shared tab stops and Listen will not ask for it again. */
    streamChanged: () => act(() => { if (tabView().off) dropTab(true); }),
    /** The setup's microphone button: on, or off when it is on. A press while the browser asks does nothing. */
    async pressMic() {
      if (s.micBusy) return;
      if (s.mic) { act(micOff); return; }
      act(() => { s.micBusy = true; });
      try {
        await micOn();
        act(() => { s.mic = true; s.micError = ""; s.micBusy = false; });
      } catch (error) {
        act(() => { s.mic = false; s.micError = error?.name || "error"; s.micBusy = false; });
      }
    },
    /** The tab button: share, or stop sharing. A press while the picker is open does nothing. */
    pressTab() {
      if (s.tabPhase === "busy") return Promise.resolve();
      if (s.tab) { act(tabOff); return Promise.resolve(); }
      return shareTab();
    },
    /** Load the speech model in its worker (once; again after it failed). */
    loadModel() {
      if (worker) return;
      const w = newWorker();
      worker = w;
      w.addEventListener("message", ({ data }) => fromWorker(w, data));
      w.addEventListener("error", () => fromWorker(w, { type: "error", reason: "the speech worker could not start" }));
      act(() => { s.model = { phase: "loading", percent: 0, reason: "" }; });
      w.postMessage({ type: "load" });
    },
    pickEngine: (engine) => act(() => pickEngine(engine)),
    /** Open producer screen: listening starts afresh, and a Listen that failed earlier says nothing any more. */
    open: () => act(() => {
      s.listen = { phase: "idle", error: "" };
      startListening();
    }),
    /** The listening sign's button: Stop while listening; else Listen, which asks for the microphone and the tab again. */
    async pressListen() {
      if (s.listen.phase === "busy") return;
      if (s.listening) { act(micOff); return; }
      const press = ++listenPress;
      let sharing = null;
      act(() => {
        s.listen = { phase: "busy", error: "" };
        // The browser lets the tab picker open only straight from a click, so it starts here, beside the microphone;
        // the microphone does not wait for it, and the tab joins once the host has picked it.
        if (tabWanted && s.tabPhase !== "busy" && !tabView().off) sharing = shareTab();
      });
      try {
        await micOn();
      } catch (error) {
        act(() => {
          s.micError = error?.name || "error";
          s.listen = { phase: "error", error: error?.name || "" };
        });
        // No microphone, nothing is listened to: a tab picked meanwhile is let go again. Only this press's own tab: a
        // later press may be waiting for the same picker.
        sharing?.then(() => {
          if (press === listenPress && !s.listening) act(() => { tabOff(); tabWanted = true; });
        });
        return;
      }
      act(() => {
        s.listen = { phase: "idle", error: "" };
        // End & report came while the browser asked for the microphone: it is let go at once.
        if (ended) { micOff(); return; }
        s.mic = true;
        s.micError = "";
        startListening();
      });
    },
    stop: () => act(micOff),
    /** End & report: listening stops for good, the tab goes and is not asked for again. */
    end: () => act(() => {
      ended = true;
      tabWanted = false;
      micOff();
      tabOff();
    }),
  };
}
