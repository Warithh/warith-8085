(() => {
  "use strict";
  const monitor = new KitMonitor();
  let beepOn = true;
  let shownFlags = monitor.user.F;
  const note = document.querySelector("#note");
  const HEX_KEYS = [
    [0xc, "C", "CBK"], [0xd, "D", "DEL"], [0xe, "E", "INS"], [0xf, "F", "♪"],
    [0x8, "8", "SIGN"], [0x9, "9", "AC"], [0xa, "A", "P"], [0xb, "B", "BRK"],
    [0x4, "4", "SP"], [0x5, "5", "PC"], [0x6, "6", "CY"], [0x7, "7", "ZERO"],
    [0x0, "0", "AF"], [0x1, "1", "BC"], [0x2, "2", "DE"], [0x3, "3", "HL"],
  ];
  const FN_KEYS = ["MOD", "USER", "RESET", "STEP", "HOME", "OPT", "GO", "ALT", "−", "ADDR", "DATA", "+"];

  const digits = [];
  const mount = document.querySelector("#digits");
  for (let row = 0; row < 2; row += 1) {
    const line = document.createElement("div");
    line.className = "digit-row";
    for (let column = 0; column < 6; column += 1) {
      const digit = document.createElement("div");
      digit.className = column === 4 ? "digit gap" : "digit";
      ["a h", "b v", "c v", "d h", "e v", "f v", "g h", "dp"].forEach((name) => {
        const segment = document.createElement("i");
        segment.className = `s ${name}`;
        digit.append(segment);
      });
      line.append(digit);
      digits.push(digit);
    }
    mount.append(line);
  }
  const fnButtons = {};
  function addKey(parent, label, altLabel, onPress) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key";
    button.innerHTML = altLabel ? `<small>${altLabel}</small><b>${label}</b>` : label;
    button.addEventListener("click", (event) => { event.currentTarget.blur(); onPress(); });
    parent.append(button);
    return button;
  }
  const hexMount = document.querySelector("#hex");
  HEX_KEYS.forEach(([value, label, altLabel]) => addKey(hexMount, label, altLabel, () => pressHex(value)));
  const fnMount = document.querySelector("#fn");
  FN_KEYS.forEach((label) => { fnButtons[label] = addKey(fnMount, label, "", () => pressFn(label)); });

  function audio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audio.ctx) audio.ctx = new AudioCtx();
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return audio.ctx;
  }
  function click() {
    if (!beepOn) return;
    const ctx = audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.012);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.exp(-(index / ctx.sampleRate) / 0.0011);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2200 + Math.random() * 800;
    const tick = ctx.createGain();
    tick.gain.setValueAtTime(0.42, now);
    noise.connect(high).connect(tick).connect(ctx.destination);
    noise.start(now);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(190 + Math.random() * 25, now);
    body.frequency.exponentialRampToValueAtTime(80, now + 0.028);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.09, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    body.connect(bodyGain).connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.032);
  }
  function paint() {
    monitor.digits().forEach((bits, index) => {
      const parts = digits[index].children;
      for (let bit = 0; bit < 8; bit += 1) parts[bit].classList.toggle("on", Boolean(bits & (1 << bit)));
    });
    fnButtons.ALT.classList.toggle("armed", monitor.alt);
    fnButtons.ADDR.classList.toggle("armed", monitor.view.kind === "mem" && monitor.mode === "addr");
    fnButtons.DATA.classList.toggle("armed", monitor.view.kind === "mem" && monitor.mode === "data");
    note.textContent = monitor.message;
    const flagBits = { S: 0x80, Z: 0x40, AC: 0x10, P: 0x04, CY: 0x01 };
    const flagsNow = monitor.user.F;
    document.querySelectorAll(".flag").forEach((flag) => {
      const bit = flagBits[flag.dataset.flag];
      flag.classList.toggle("on", Boolean(flagsNow & bit));
      flag.classList.toggle("changed", Boolean((flagsNow ^ shownFlags) & bit));
    });
    shownFlags = flagsNow;
    paintListing();
    document.querySelectorAll(".is-current").forEach((cell) => cell.classList.remove("is-current"));
    if (monitor.view.kind === "mem") {
      const current = document.querySelector(`#chartBody td[data-opcode="${monitor.memory[monitor.address]}"]`);
      if (current && current.textContent) {
        current.classList.add("is-current");
        current.previousElementSibling.classList.add("is-current");
      }
    }
  }
  function paintListing() {
    const rows = [];
    let address = 0x8100;
    let currentIndex = -1;
    for (let count = 0; count < 48; count += 1) {
      const decoded = I8085.disassemble(monitor.memory, address);
      const size = decoded.size || 1;
      const bytes = [];
      for (let offset = 0; offset < size; offset += 1) bytes.push(I8085.hex(monitor.memory[(address + offset) & 0xffff]));
      const current = monitor.address >= address && monitor.address < address + size;
      rows.push({ address, text: decoded.text, bytes: bytes.join(" "), current });
      if (current) currentIndex = rows.length - 1;
      address = (address + size) & 0xffff;
      if (currentIndex >= 0 && rows.length >= currentIndex + 2 && rows.length >= 6) break;
    }
    const start = currentIndex < 4 ? 0 : currentIndex - 1;
    const list = document.querySelector("#programList");
    list.replaceChildren();
    rows.slice(start, start + 6).forEach((row) => {
      const item = document.createElement("li");
      if (row.current) item.className = "current";
      item.innerHTML = `<span>${I8085.hex(row.address, 4)}</span><span>${row.bytes}</span><b>${row.text}</b>`;
      list.append(item);
    });
  }
  function accept(result) {
    if (!result.accepted) return;
    click();
    if (result.toggleSound) {
      beepOn = !beepOn;
      monitor.message = beepOn ? "Key click is on." : "Key click is off.";
    }
    paint();
    if (result.run) runFrame();
  }
  function pressHex(nibble) { cancelBoot(); accept(monitor.pressHex(nibble)); }
  function pressFn(label) { cancelBoot(); accept(monitor.pressFn(label)); }
  function runFrame() {
    if (!monitor.running) { paint(); return; }
    let changed = false;
    for (let count = 0; count < 2000 && monitor.running; count += 1) {
      if (monitor.advance() === "port") { changed = true; break; }
    }
    paint();
    if (!monitor.running) return;
    if (changed) setTimeout(runFrame, 70);
    else requestAnimationFrame(runFrame);
  }

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toUpperCase();
    if (/^[0-9A-F]$/.test(key)) { event.preventDefault(); pressHex(parseInt(key, 16)); return; }
    const action = { "+": "+", "=": "+", "-": "−", ARROWRIGHT: "+", ARROWLEFT: "−", ENTER: "GO", ESCAPE: "RESET" }[key];
    if (!action) return;
    event.preventDefault();
    pressFn(action);
  });

  const boot = [0, 0, 0, 0, 0, 0x7f, 0x3f, 0x7f, 0x6d, 0, 0];
  let bootIndex = 0;
  let booting = true;
  const bootTimer = setInterval(() => {
    if (!booting) return;
    const frame = boot.slice(bootIndex, bootIndex + 6).concat([0, 0, 0, 0, 0, 0]);
    frame.forEach((bits, index) => {
      const parts = digits[index].children;
      for (let bit = 0; bit < 8; bit += 1) parts[bit].classList.toggle("on", Boolean(bits & (1 << bit)));
    });
    bootIndex += 1;
    if (bootIndex > 5) {
      booting = false;
      clearInterval(bootTimer);
      paint();
    }
  }, 140);
  const names = new Array(256);
  const scratch = new Uint8Array(3);
  for (let opcode = 0; opcode < 256; opcode += 1) {
    scratch[0] = opcode;
    const decoded = I8085.disassemble(scratch, 0);
    names[opcode] = decoded.defined ? decoded.text.replace(/,[0-9A-F]{2,4}H$/, "").replace(/ [0-9A-F]{2,4}H$/, "") : "";
  }
  const chart = document.querySelector("#chartBody");
  for (let row = 0; row < 64; row += 1) {
    const tr = document.createElement("tr");
    for (let column = 0; column < 4; column += 1) {
      const opcode = column * 64 + row;
      const hexCell = document.createElement("td");
      hexCell.className = "hex";
      hexCell.textContent = I8085.hex(opcode);
      const nameCell = document.createElement("td");
      nameCell.dataset.opcode = String(opcode);
      nameCell.textContent = names[opcode];
      tr.append(hexCell, nameCell);
    }
    chart.append(tr);
  }

  function cancelBoot() {
    if (!booting) return;
    booting = false;
    clearInterval(bootTimer);
  }
  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register("./service-worker.js");
  }
})();
