(() => {
  "use strict";
  const api = globalThis.I8085;
  const cpu = new api.CPU8085();
  const memory = cpu.memory;
  const REG = ["A", "B", "C", "D", "E", "F", "H", "L", "I", "S", "P"];
  const COMMANDS = {
    E: "Enter", M: "Modify", R: "Regs", S: "Step", G: "Go", L: "List",
    B: "Move", I: "Insert", D: "Delete", F: "Fill", H: "Relocate",
    J: "Compare", K: "String", A: "Assemble", C: "Disasm",
  };
  const COUNTS = { L: 2, B: 3, F: 3, H: 3, J: 3, K: 4, D: 4, I: 4 };

  let mode = "ready";
  let command = "";
  let buffer = "";
  let fields = [];
  let address = 0;
  let entry = 0;
  let pending = false;
  let listAt = 0;
  let listStart = 0;
  let listEnd = 0;
  let asmText = "";

  const lineEls = [...document.querySelectorAll(".lcd-line")];
  const note = document.querySelector("#note");

  function hex(value, width) {
    return (value & ((1 << (width * 4)) - 1)).toString(16).toUpperCase().padStart(width, "0");
  }
  function fit(text) {
    return String(text).toUpperCase().padEnd(20, " ").slice(0, 20);
  }
  function dumpLine(addr) {
    const here = addr & 0xffff;
    const bytes = [0, 1, 2, 3].map((offset) => {
      const at = (here + offset) & 0xffff;
      return at >= listStart && at <= listEnd ? hex(memory[at], 2) : "##";
    }).join(" ");
    return `${hex(here, 4)} ${bytes}`;
  }
  function showList(addr) {
    const here = addr & 0xffff;
    lineEls[0].textContent = fit(dumpLine(here));
    lineEls[1].textContent = fit(dumpLine((here + 4) & 0xffff));
  }
  function showAt(addr, byteText) {
    const here = addr & 0xffff;
    const next = (here + 1) & 0xffff;
    const byte = byteText == null ? hex(memory[here], 2) : byteText;
    lineEls[0].textContent = fit(`${hex(here, 4)}  ${byte}`);
    lineEls[1].textContent = fit(`${hex(next, 4)}  ${hex(memory[next], 2)}`);
  }
  function showBlank(text) {
    lineEls[0].textContent = fit(text);
    lineEls[1].textContent = fit("");
  }
  function say(text) {
    note.textContent = text;
  }
  function number(text, width) {
    const digits = (text || "0").replace(/[^0-9A-F]/gi, "").slice(-width);
    return Number.parseInt(digits || "0", 16);
  }
  function span(start, end) {
    const count = ((end - start) & 0xffff) + 1;
    const bytes = [];
    for (let i = 0; i < count && i < 65536; i += 1) bytes.push(memory[(start + i) & 0xffff]);
    return bytes;
  }
  function writeSpan(start, bytes) {
    bytes.forEach((value, index) => { memory[(start + index) & 0xffff] = value; });
  }
  function fix(bytes, from, to, delta) {
    const view = new Uint8Array(3);
    for (let index = 0; index < bytes.length;) {
      view[0] = bytes[index];
      view[1] = bytes[index + 1] || 0;
      view[2] = bytes[index + 2] || 0;
      const decoded = api.disassemble(view, 0);
      if (decoded.size === 3 && index + 2 < bytes.length) {
        const target = bytes[index + 1] | (bytes[index + 2] << 8);
        if (target >= from && target <= to) {
          const moved = (target + delta) & 0xffff;
          bytes[index + 1] = moved & 255;
          bytes[index + 2] = moved >> 8;
        }
      }
      index += decoded.size || 1;
    }
  }
  function flagByte() {
    return (cpu.flags.S ? 0x80 : 0) | (cpu.flags.Z ? 0x40 : 0) | (cpu.flags.AC ? 0x10 : 0) | (cpu.flags.P ? 4 : 0) | 2 | (cpu.flags.CY ? 1 : 0);
  }
  function setFlagByte(value) {
    cpu.flags.S = Boolean(value & 0x80);
    cpu.flags.Z = Boolean(value & 0x40);
    cpu.flags.AC = Boolean(value & 0x10);
    cpu.flags.P = Boolean(value & 4);
    cpu.flags.CY = Boolean(value & 1);
  }
  function regValue(name) {
    if (name === "A") return cpu.reg.A;
    if (name === "F") return flagByte();
    if (name === "I") {
      return (cpu.interruptMasks[5.5] ? 1 : 0) | (cpu.interruptMasks[6.5] ? 2 : 0) | (cpu.interruptMasks[7.5] ? 4 : 0) | (cpu.interruptsEnabled ? 8 : 0);
    }
    if (name === "S") return cpu.SP;
    if (name === "P") return cpu.PC;
    return cpu.reg[name];
  }
  function setReg(name, value) {
    if (name === "A") cpu.reg.A = value & 255;
    else if (name === "F") setFlagByte(value);
    else if (name === "I") {
      cpu.interruptMasks[5.5] = Boolean(value & 1);
      cpu.interruptMasks[6.5] = Boolean(value & 2);
      cpu.interruptMasks[7.5] = Boolean(value & 4);
      cpu.interruptsEnabled = Boolean(value & 8);
    } else if (name === "S") cpu.SP = value & 0xffff;
    else if (name === "P") cpu.PC = value & 0xffff;
    else cpu.reg[name] = value & 255;
  }
  function regWidth(name) {
    return name === "S" || name === "P" ? 4 : 2;
  }
  function showHome() {
    lineEls[0].textContent = fit("microprocessor");
    lineEls[1].textContent = fit("8085 kit");
  }
  function ready(message) {
    mode = "ready";
    command = "";
    buffer = "";
    fields = [];
    pending = false;
    asmText = "";
    address = entry;
    cpu.PC = entry;
    showHome();
    say(message || "");
    if (window.LabState) LabState.write(cpu, { view: address, entry });
  }
  function paintEntry() {
    if (command === "E" && mode === "data") return showAt(address, (buffer || "").padEnd(2, "_"));
    if (command === "M" && mode === "data") return showAt(address, buffer || hex(memory[address], 2));
    if (command === "R" && mode === "reg") {
      const name = REG[fields.length] || "A";
      const shown = buffer || hex(regValue(name), regWidth(name));
      return showBlank(`${name}=${shown}`);
    }
    if (command === "S" && mode === "step-addr") return showBlank((buffer || "").padEnd(4, "_"));
    if (command === "A" && mode === "asm") return showBlank(`${hex(address, 4)} ${asmText}`.trim());
    if (command === "C" && mode === "dis") {
      say(api.disassemble(memory, address).text);
      return showAt(address);
    }
    if (mode === "list") return showList(listAt);
    if (command === "I" && mode === "insert") return showAt(address, buffer || hex(memory[address], 2));
    if (command === "F" && fields.length === 2) return showAt(fields[0], (buffer || "").padEnd(2, "_"));
    if (mode === "args" || mode === "step-addr") return showBlank((buffer || "").padEnd(4, "_"));
    return showAt(buffer ? number(buffer, 4) : address);
  }

  function begin(name) {
    command = name;
    buffer = "";
    fields = [];
    pending = false;
    asmText = "";
    mode = "args";
    if (name === "S") {
      mode = "step-addr";
      address = cpu.PC;
    }
    say("");
    paintEntry();
  }
  function takeField(width) {
    const value = number(buffer, width);
    buffer = "";
    return value;
  }
  function commitByte() {
    if (!buffer) return false;
    memory[address] = number(buffer, 2);
    buffer = "";
    pending = false;
    return true;
  }
  function runGo() {
    cpu.halted = false;
    let steps = 0;
    while (steps < 20000) {
      if (memory[cpu.PC] === 0xef || memory[cpu.PC] === 0x76) break;
      const result = cpu.step();
      steps += 1;
      if (result.halted) break;
    }
    address = cpu.PC;
    return `A=${hex(cpu.reg.A, 2)}`;
  }
  function stepOne() {
    if (memory[cpu.PC] === 0xef) {
      say("RST 5");
      showAt(cpu.PC);
      return;
    }
    const decoded = api.disassemble(memory, cpu.PC);
    cpu.halted = false;
    cpu.step();
    say(decoded.text);
    address = cpu.PC;
    showAt(cpu.PC);
  }
  function executeFields() {
    const values = fields.slice();
    if (buffer) values.push(number(buffer, command === "F" && fields.length === 2 ? 2 : 4));
    const need = COUNTS[command];
    if (need && values.length < need) {
      say("More values are required. Separate them with comma.");
      return;
    }
    const [a, b, c, d] = values;
    if (command === "L") {
      let start = a & 0xffff;
      let end = b & 0xffff;
      if (end < start) {
        const swap = start;
        start = end;
        end = swap;
      }
      listStart = start;
      listEnd = end;
      listAt = start;
      address = listAt;
      mode = "list";
      say("");
      paintEntry();
      return;
    }
    if (command === "B" || command === "H") {
      const bytes = span(a, b);
      if (command === "H") fix(bytes, a, b, (c - a) & 0xffff);
      writeSpan(c, bytes);
      ready(command === "H" ? "Program relocated." : "Block moved.");
      return;
    }
    if (command === "F") {
      const start = a & 0xffff;
      const end = b & 0xffff;
      const count = ((end - start) & 0xffff) + 1;
      for (let i = 0; i < count && i < 65536; i += 1) memory[(start + i) & 0xffff] = c & 255;
      ready(`Filled ${hex(start, 4)} to ${hex(end, 4)}.`);
      return;
    }
    if (command === "J") {
      const count = ((b - a) & 0xffff) + 1;
      for (let i = 0; i < count && i < 65536; i += 1) {
        const left = memory[(a + i) & 0xffff];
        const right = memory[(c + i) & 0xffff];
        if (left !== right) return ready(`${hex((a + i) & 0xffff, 4)} ${hex(left, 2)} ${hex(right, 2)}`);
      }
      ready("The two blocks are the same.");
      return;
    }
    if (command === "K") {
      const pattern = span(c, d);
      const count = ((b - a) & 0xffff) + 1;
      for (let index = 0; index < count; index += 1) {
        const at = (a + index) & 0xffff;
        if (pattern.every((value, offset) => memory[(at + offset) & 0xffff] === value)) {
          address = at;
          showAt(at);
          say("");
          mode = "found";
          return;
        }
      }
      return ready("Not found");
    }
    if (command === "D") {
      const program = span(a, b);
      const cut = Math.max(0, (c - a) & 0xffff);
      const removed = ((d - c) & 0xffff) + 1;
      program.splice(cut, removed);
      fix(program, c, b, -removed);
      writeSpan(a, program);
      const oldLength = ((b - a) & 0xffff) + 1;
      for (let index = program.length; index < oldLength; index += 1) memory[(a + index) & 0xffff] = 0;
      ready("Bytes deleted.");
      return;
    }
    if (command === "I") {
      mode = "insert";
      fields = values.slice(0, 4);
      buffer = "";
      address = values[2] & 0xffff;
      say("");
      paintEntry();
    }
  }
  function pressCommand(name) {
    if (name === "Reset") {
      cpu.PC = entry;
      address = entry;
      ready("");
      return;
    }
    if (name === "Enter" || name === ",") return pressSeparator(name);
    if (name === ".") return pressDot();
    if (name === ":") return pressColon();
    if (name === "Space") return pressSpace();
    if (COMMANDS[name]) {
      if (mode !== "ready" && mode !== "asm" && /^[A-F]$/.test(name) && command !== "R") return pressHex(Number.parseInt(name, 16));
      if (command === "R" && REG.includes(name)) return pressLetter(name);
      if (command === "A" && mode === "asm") return pressLetter(name);
      begin(name);
    }
  }
  function pressSeparator(name) {
    if (mode === "ready") return;
    if (command === "E" && mode !== "data") {
      address = takeField(4);
      mode = "data";
      say("");
      paintEntry();
      return;
    }
    if (command === "E") {
      commitByte();
      address = (address + 1) & 0xffff;
      paintEntry();
      return;
    }
    if (command === "M" && mode !== "data") {
      address = takeField(4);
      mode = "data";
      pending = false;
      say("");
      paintEntry();
      return;
    }
    if (command === "M") {
      if (buffer) commitByte();
      address = (address + 1) & 0xffff;
      paintEntry();
      return;
    }
    if (command === "R") {
      const name = REG[fields.length] || "A";
      if (buffer) setReg(name, number(buffer, regWidth(name)));
      fields.push(name);
      buffer = "";
      if (fields.length >= REG.length) return ready("Registers updated.");
      paintEntry();
      return;
    }
    if (command === "S" && mode === "step-addr") {
      if (!buffer) return paintEntry();
      cpu.PC = takeField(4);
      mode = "step";
      stepOne();
      return;
    }
    if (command === "S") {
      stepOne();
      return;
    }
    if (command === "G") {
      if (buffer) cpu.PC = takeField(4);
      if (name === ".") ready(runGo());
      else {
        address = cpu.PC;
        say("");
        showAt(cpu.PC);
      }
      return;
    }
    if (command === "A" && mode !== "asm") {
      address = takeField(4);
      mode = "asm";
      asmText = "";
      say("");
      paintEntry();
      return;
    }
    if (command === "A") return commitAssembly();
    if (command === "C" && mode !== "dis") {
      address = takeField(4);
      mode = "dis";
      say(api.disassemble(memory, address).text);
      paintEntry();
      return;
    }
    if (command === "C" || mode === "list") {
      if (mode === "list") {
        const next = (listAt + 4) & 0xffff;
        if (next > listEnd || next < listAt) return ready("");
        listAt = next;
        address = listAt;
        say("");
      } else {
        address = (address + api.disassemble(memory, address).size) & 0xffff;
      }
      paintEntry();
      return;
    }
    if (mode === "found") {
      fields[0] = (address + 1) & 0xffff;
      buffer = "";
      command = "K";
      return executeFields();
    }
    if (command === "I" && mode === "insert") {
      if (buffer) fields.push(number(buffer, 2));
      buffer = "";
      address = (fields[2] + fields.length - 4) & 0xffff;
      say("");
      paintEntry();
      return;
    }
    const width = command === "F" && fields.length === 2 ? 2 : 4;
    if (buffer || name === ",") fields.push(takeField(width));
    buffer = "";
    if (fields.length >= (COUNTS[command] || 1)) executeFields();
    else paintEntry();
  }
  function pressDot() {
    if (command === "G") return pressSeparator(".");
    if (command === "E" || command === "M") {
      if (mode === "data") commitByte();
      return ready("");
    }
    if (command === "R") {
      const name = REG[fields.length] || "A";
      if (buffer) setReg(name, number(buffer, regWidth(name)));
      return ready("");
    }
    if (command === "A" || command === "C" || command === "S" || mode === "list" || mode === "found") return ready("");
    if (command === "I" && mode === "insert") {
      const [start, end, at, count] = fields;
      const data = fields.slice(4);
      if (buffer) data.push(number(buffer, 2));
      const program = span(start, end);
      const bytes = data.slice(0, count);
      while (bytes.length < count) bytes.push(0);
      program.splice((at - start) & 0xffff, 0, ...bytes);
      fix(program, at, (end + count) & 0xffff, count);
      writeSpan(start, program);
      return ready("Bytes inserted.");
    }
    if (COUNTS[command]) {
      const pendingValues = fields.length + (buffer ? 1 : 0);
      if (pendingValues >= COUNTS[command]) return executeFields();
    }
    ready("");
  }
  function pressColon() {
    if (command === "E" && mode === "data") {
      commitByte();
      mode = "args";
      buffer = "";
      say("");
      paintEntry();
    }
  }
  function pressSpace() {
    if (command === "A" && mode === "asm") {
      asmText = `${asmText} `.slice(0, 20);
      paintEntry();
    }
  }
  function commitAssembly() {
    const text = asmText.trim();
    if (!text) return;
    try {
      const program = api.assemble(`ORG ${hex(address, 4)}H\n${text}`);
      program.occupied.forEach((used, index) => { if (used) memory[index] = program.memory[index]; });
      const row = program.listing.find((item) => item.bytes.length);
      address = row ? (row.address + row.bytes.length) & 0xffff : address;
      asmText = "";
      say("");
      paintEntry();
    } catch (error) {
      say(error.message || "Bad instruction");
      showAt(address);
    }
  }
  function pressHex(nibble) {
    const digit = nibble.toString(16).toUpperCase();
    if (command === "A" && mode === "asm") {
      asmText = (asmText + digit).slice(0, 20);
      paintEntry();
      return;
    }
    if (command === "R" && mode === "args" && !buffer && /[A-F]/.test(digit) && REG.includes(digit)) {
      const index = REG.indexOf(digit);
      fields = REG.slice(0, index);
      mode = "reg";
      paintEntry();
      return;
    }
    if (mode === "ready") return;
    const width = (command === "M" && mode === "data") || (command === "E" && mode === "data") || (command === "I" && mode === "insert") || (command === "F" && fields.length === 2) || (command === "R" && regWidth(REG[fields.length] || "A") === 2)
      ? 2 : 4;
    buffer = (buffer + digit).slice(-width);
    if (command === "M") pending = true;
    paintEntry();
  }
  function pressLetter(letter) {
    if (command === "A" && mode === "asm") {
      asmText = (asmText + letter).slice(0, 20);
      paintEntry();
      return;
    }
    if (command === "R" && REG.includes(letter)) {
      fields = REG.slice(0, REG.indexOf(letter));
      mode = "reg";
      buffer = "";
      paintEntry();
      return;
    }
    if (mode === "ready" && COMMANDS[letter]) begin(letter);
  }

  const commands = document.querySelector("#commands");
  Object.entries(COMMANDS).forEach(([label, hint]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key command";
    button.innerHTML = `<small>${hint}</small>${label}`;
    button.addEventListener("click", () => pressCommand(label));
    commands.append(button);
  });
  const marks = document.querySelector("#marks");
  [["Enter", "Enter"], [",", "Next"], [".", "End"], [":", "Addr"], ["Space", "Space"], ["Reset", "Reset"]].forEach(([label, hint]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key mark";
    button.innerHTML = `<small>${hint}</small>${label === "Space" ? "␣" : label}`;
    button.addEventListener("click", () => pressCommand(label));
    marks.append(button);
  });
  const hexPad = document.querySelector("#hex");
  "0123456789ABCDEF".split("").forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key";
    button.textContent = label;
    button.addEventListener("click", () => pressHex(Number.parseInt(label, 16)));
    hexPad.append(button);
  });
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === "Enter") { event.preventDefault(); pressCommand("Enter"); return; }
    if (key === "Escape") { event.preventDefault(); pressCommand("Reset"); return; }
    if (key === ",") { event.preventDefault(); pressCommand(","); return; }
    if (key === ".") { event.preventDefault(); pressCommand("."); return; }
    if (key === ":") { event.preventDefault(); pressCommand(":"); return; }
    if (key === " ") { event.preventDefault(); pressCommand("Space"); return; }
    const upper = key.toUpperCase();
    if (/^[0-9]$/.test(upper)) { event.preventDefault(); pressHex(Number.parseInt(upper, 16)); return; }
    if (/^[A-Z]$/.test(upper)) {
      event.preventDefault();
      if (mode !== "ready" && mode !== "asm" && /[0-9A-F]/.test(upper) && command !== "R") pressHex(Number.parseInt(upper, 16));
      else pressLetter(upper);
    }
  });
  window.addEventListener("pagehide", () => {
    if (window.LabState) LabState.write(cpu, { view: address, entry });
  });
  LabState.read().then((saved) => {
    if (saved) {
      LabState.apply(cpu, saved);
      entry = saved.entry & 0xffff;
      address = (saved.view ?? saved.pc) & 0xffff;
    }
    showHome();
    say("");
  });
  const opcodeList = document.querySelector("#opcodes");
  const opcodeTitle = document.createElement("h2");
  opcodeTitle.textContent = "Opcodes";
  opcodeList.append(opcodeTitle);
  const sample = new Uint8Array(3);
  for (let op = 0; op < 256; op += 1) {
    sample[0] = op;
    const decoded = api.disassemble(sample, 0);
    if (!decoded.defined) continue;
    const meaning = decoded.text
      .replace(/,[0-9A-F]{4}H$/, ",addr")
      .replace(/ [0-9A-F]{4}H$/, " addr")
      .replace(/,[0-9A-F]{2}H$/, ",byte")
      .replace(/ [0-9A-F]{2}H$/, " byte");
    const row = document.createElement("p");
    const code = document.createElement("b");
    code.textContent = hex(op, 2);
    row.append(code, ` ${meaning}`);
    opcodeList.append(row);
  }
})();
