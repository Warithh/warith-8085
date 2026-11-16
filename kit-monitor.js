(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KitMonitor = api.KitMonitor;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const I8085 = typeof require === "function" ? require("./core.js") : globalThis.I8085;
  const SEG = {
    0: 0x3f, 1: 0x06, 2: 0x5b, 3: 0x4f, 4: 0x66, 5: 0x6d, 6: 0x7d, 7: 0x07,
    8: 0x7f, 9: 0x6f, A: 0x77, B: 0x7c, C: 0x39, D: 0x5e, E: 0x79, F: 0x71,
  };
  const PAIRS = ["AF", "BC", "DE", "HL", "SP", "PC"];
  const FLAG_BITS = { 6: 1, 7: 0x40, 8: 0x80, 9: 0x10, 10: 4 };

  class KitMonitor {
    constructor(cpu) {
      this.cpu = cpu || new I8085.CPU8085();
      this.memory = this.cpu.memory;
      this.user = { A: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0, SP: 0xf079, F: 0x02, PC: 0x8100 };
      this.address = 0x8100;
      this.mode = "data";
      this.alt = false;
      this.userArm = false;
      this.view = { kind: "mem" };
      this.editing = null;
      this.breakpoint = null;
      this.running = false;
      this.stepped = false;
      this.message = "Boot points at 8100. Entry is in the data field.";
    }

    hexPatterns(value, width) {
      return [...value.toString(16).toUpperCase().padStart(width, "0").slice(-width)]
        .map((char) => SEG[parseInt(char, 16)]);
    }

    memoryLine(address, marked) {
      const patterns = this.hexPatterns(address, 4).concat(this.hexPatterns(this.memory[address & 0xffff], 2));
      const dots = marked ? (this.mode === "addr" ? 0x0f : 0x30) : 0;
      return patterns.map((bits, index) => (dots & (1 << index) ? bits | 0x80 : bits));
    }

    digits() {
      const next = (this.address + 1) & 0xffff;
      if (this.view.kind === "pair") {
        const top = this.hexPatterns(this.view.value, 4).concat([0, 0]);
        top[3] |= 0x80;
        return top.concat(this.memoryLine(this.address, false));
      }
      if (this.view.kind !== "mem") {
        const top = [0, 0, 0, 0].concat(this.hexPatterns(this.view.value, 2));
        top[4] |= 0x80;
        top[5] |= 0x80;
        return top.concat(this.memoryLine(this.address, false));
      }
      return this.memoryLine(this.address, true).concat(this.memoryLine(next, false));
    }

    showMemory() {
      this.view = { kind: "mem" };
      this.editing = null;
    }

    flagByte() {
      const flags = this.cpu.flags;
      return (flags.S ? 0x80 : 0) | (flags.Z ? 0x40 : 0) | (flags.AC ? 0x10 : 0) | (flags.P ? 4 : 0) | 2 | (flags.CY ? 1 : 0);
    }

    pairValue(name) {
      const user = this.user;
      if (name === "AF") return (user.A << 8) | user.F;
      if (name === "BC") return (user.B << 8) | user.C;
      if (name === "DE") return (user.D << 8) | user.E;
      if (name === "HL") return (user.H << 8) | user.L;
      if (name === "SP") return user.SP;
      return user.PC;
    }

    storePair(name, value) {
      const user = this.user;
      value &= 0xffff;
      if (name === "AF") { user.A = value >> 8; user.F = value & 0xff; }
      else if (name === "BC") { user.B = value >> 8; user.C = value & 0xff; }
      else if (name === "DE") { user.D = value >> 8; user.E = value & 0xff; }
      else if (name === "HL") { user.H = value >> 8; user.L = value & 0xff; }
      else if (name === "SP") user.SP = value;
      else { user.PC = value; this.address = value; }
    }

    loadCpu() {
      const user = this.user;
      this.cpu.halted = false;
      this.cpu.reg.A = user.A; this.cpu.reg.B = user.B; this.cpu.reg.C = user.C;
      this.cpu.reg.D = user.D; this.cpu.reg.E = user.E; this.cpu.reg.H = user.H; this.cpu.reg.L = user.L;
      this.cpu.SP = user.SP;
      this.cpu.PC = this.address & 0xffff;
      this.cpu.flags.S = !!(user.F & 0x80); this.cpu.flags.Z = !!(user.F & 0x40);
      this.cpu.flags.AC = !!(user.F & 0x10); this.cpu.flags.P = !!(user.F & 4); this.cpu.flags.CY = !!(user.F & 1);
    }

    saveCpu() {
      const user = this.user;
      user.A = this.cpu.reg.A; user.B = this.cpu.reg.B; user.C = this.cpu.reg.C;
      user.D = this.cpu.reg.D; user.E = this.cpu.reg.E; user.H = this.cpu.reg.H; user.L = this.cpu.reg.L;
      user.SP = this.cpu.SP; user.PC = this.cpu.PC; user.F = this.flagByte();
    }

    pressHex(nibble) {
      if (this.running) return { accepted: false, message: this.message };
      this.userArm = false;
      if (this.alt) {
        this.alt = false;
        return this.altAction(nibble);
      }
      if (this.editing) {
        this.editing.value = ((this.editing.value << 4) | nibble) & 0xffff;
        this.editing.got += 1;
        this.view = { kind: "pair", name: this.editing.name, value: this.editing.value };
        if (this.editing.got === 4) {
          this.storePair(this.editing.name, this.editing.value);
          this.message = `${this.editing.name} set to ${I8085.hex(this.editing.value, 4)}.`;
          this.editing = null;
        }
        return { accepted: true, message: this.message };
      }
      this.view = { kind: "mem" };
      if (this.mode === "addr") this.address = ((this.address << 4) | nibble) & 0xffff;
      else this.memory[this.address] = ((this.memory[this.address] << 4) | nibble) & 0xff;
      return { accepted: true, message: this.message };
    }

    altAction(nibble) {
      if (nibble <= 5) {
        const name = PAIRS[nibble];
        this.view = { kind: "pair", name, value: this.pairValue(name) };
        this.message = `${name} = ${I8085.hex(this.view.value, 4)}. Press MOD, then four digits.`;
        return { accepted: true, message: this.message };
      }
      if (FLAG_BITS[nibble]) {
        this.view = { kind: "flag", value: this.user.F & FLAG_BITS[nibble] ? 1 : 0 };
        this.message = "The flag is in the data field: 01 is set, 00 is clear.";
        return { accepted: true, message: this.message };
      }
      if (nibble === 0xb) {
        this.breakpoint = this.address;
        this.message = `Breakpoint at ${I8085.hex(this.address, 4)}.`;
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (nibble === 0xc) {
        this.breakpoint = null;
        this.message = "Breakpoint cleared.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (nibble === 0xd) {
        for (let index = this.address; index < 0xffff; index += 1) this.memory[index] = this.memory[index + 1];
        this.message = "Byte deleted. Later bytes moved up.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (nibble === 0xe) {
        for (let index = 0xfffe; index >= this.address; index -= 1) this.memory[index + 1] = this.memory[index];
        this.memory[this.address] = 0;
        this.message = "00 inserted. Later bytes moved down.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      this.showMemory();
      return { accepted: true, toggleSound: true, message: this.message };
    }

    pressFn(label) {
      if (label !== "RESET" && this.running) return { accepted: false, message: this.message };
      const armedUser = this.userArm;
      if (label !== "ALT") this.alt = false;
      if (label !== "USER") this.userArm = false;
      if (label === "RESET") {
        this.running = false;
        if (armedUser && this.memory[0x8000] === 0xc3) this.memory[0x8000] = 0;
        this.address = 0x8100;
        this.mode = "data";
        this.editing = null;
        this.cpu.halted = false;
        this.message = "RESET. Address is 8100 and entry is in data. Memory was kept.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (label === "ADDR") {
        this.mode = "addr";
        this.message = "Entry is in the address. Dots mark the four address digits.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (label === "DATA") {
        this.mode = "data";
        this.message = "Entry is in the data. Dots mark the two data digits.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (label === "+" || label === "−" || label === "-") {
        this.address = (this.address + (label === "+" ? 1 : -1)) & 0xffff;
        this.message = label === "+" ? "Next address." : "Previous address.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (label === "HOME") {
        this.address = 0x8100;
        this.message = "Home is 8100.";
        this.showMemory();
        return { accepted: true, message: this.message };
      }
      if (label === "ALT") {
        this.alt = true;
        this.editing = null;
        this.message = "ALT is armed. Press a key for the small label.";
        return { accepted: true, message: this.message };
      }
      if (label === "MOD") {
        if (this.view.kind !== "pair") {
          this.message = "Show a register with ALT and 0–5 before MOD.";
          return { accepted: true, message: this.message };
        }
        this.editing = { name: this.view.name, value: 0, got: 0 };
        this.view = { kind: "pair", name: this.view.name, value: 0 };
        this.message = `Enter four digits for ${this.editing.name}.`;
        return { accepted: true, message: this.message };
      }
      if (label === "STEP") return this.stepOnce();
      if (label === "GO") return this.beginRun();
      if (label === "OPT") {
        this.view = { kind: "pair", name: "BP", value: this.breakpoint == null ? 0 : this.breakpoint };
        this.message = this.breakpoint == null ? "No breakpoint." : `Breakpoint ${I8085.hex(this.breakpoint, 4)}.`;
        return { accepted: true, message: this.message };
      }
      this.userArm = true;
      this.message = "USER is armed. RESET with it clears a C3 boot jump at 8000.";
      return { accepted: true, message: this.message };
    }

    stepOnce() {
      this.loadCpu();
      const at = this.cpu.PC;
      const decoded = I8085.disassemble(this.memory, at);
      this.cpu.step();
      this.saveCpu();
      this.address = this.cpu.PC;
      this.message = this.cpu.halted ? "HLT." : `${decoded.text} at ${I8085.hex(at, 4)}. Next is ${I8085.hex(this.address, 4)}.`;
      this.showMemory();
      return { accepted: true, message: this.message };
    }

    beginRun() {
      this.view = { kind: "mem" };
      this.editing = null;
      this.loadCpu();
      this.running = true;
      this.stepped = false;
      this.message = "GO. RESET stops execution.";
      return { accepted: true, run: true, message: this.message };
    }

    advance() {
      if (!this.running) return "idle";
      if (this.cpu.halted) {
        this.running = false;
        this.saveCpu();
        this.address = this.cpu.PC;
        this.message = "Stopped at HLT.";
        this.showMemory();
        return "hlt";
      }
      if (this.stepped && this.breakpoint != null && this.cpu.PC === this.breakpoint) {
        this.running = false;
        this.saveCpu();
        this.address = this.cpu.PC;
        this.message = "Stopped at the breakpoint.";
        this.showMemory();
        return "break";
      }
      const before = this.cpu.ports[0];
      this.cpu.step();
      this.stepped = true;
      this.saveCpu();
      this.address = this.cpu.PC;
      return this.cpu.ports[0] !== before ? "port" : "ok";
    }
  }

  return { KitMonitor };
});
