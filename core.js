(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.I8085 = api;
})(globalThis, function () {
  "use strict";

  const REGISTERS = ["B", "C", "D", "E", "H", "L", "M", "A"];
  const PAIRS = ["B", "D", "H", "SP"];
  const CONDITIONS = {
    NZ: (f) => !f.Z, Z: (f) => f.Z, NC: (f) => !f.CY, C: (f) => f.CY,
    PO: (f) => !f.P, PE: (f) => f.P, P: (f) => !f.S, M: (f) => f.S,
  };
  const ALU_NAMES = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"];
  const ALU_IMM = ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI"];
  const FLAG_MASK = 0xd5;

  function hex(value, width) {
    return (value >>> 0).toString(16).toUpperCase().padStart(width || 2, "0");
  }
  function parity(value) {
    let bits = value & 0xff, ones = 0;
    while (bits) { ones ^= 1; bits &= bits - 1; }
    return ones === 0;
  }
  function parseNumber(text, symbols, line) {
    const source = text.replace(/\s+/g, "");
    if (/^'.*'$/.test(source) && source.length >= 3) return source.charCodeAt(1);
    const terms = source.match(/[+-]?[^+-]+/g);
    if (!terms || terms.join("") !== source) {
      throw new AssemblerError(line, `تعبير غير صالح: ${text}`);
    }
    let result = 0;
    for (const term of terms) {
      const item = term.trim();
      const sign = item[0] === "-" ? -1 : 1;
      const token = item.replace(/^[+-]/, "").trim();
      let value;
      if (/^0x[0-9a-f]+$/i.test(token)) value = parseInt(token.slice(2), 16);
      else if (/^[0-9a-f]+h$/i.test(token)) value = parseInt(token.slice(0, -1), 16);
      else if (/^[01]+b$/i.test(token)) value = parseInt(token.slice(0, -1), 2);
      else if (/^\d+$/.test(token)) value = Number(token);
      else if (Object.prototype.hasOwnProperty.call(symbols, token.toUpperCase())) value = symbols[token.toUpperCase()];
      else throw new AssemblerError(line, `رمز أو قيمة غير معروفة: ${token}`);
      result += sign * value;
    }
    if (!Number.isFinite(result)) throw new AssemblerError(line, "قيمة غير صالحة");
    return result;
  }
  class AssemblerError extends Error {
    constructor(line, message) {
      super(message);
      this.name = "AssemblerError";
      this.line = line;
    }
  }

  function stripComment(source) {
    let quote = "";
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === quote && source[i - 1] !== "\\") quote = ""; }
      else if (c === "'" || c === '"') quote = c;
      else if (c === ";") return source.slice(0, i);
    }
    return source;
  }
  function splitArgs(text) {
    const out = [];
    let current = "", quote = "";
    for (const c of text) {
      if (quote) { current += c; if (c === quote) quote = ""; }
      else if (c === "'" || c === '"') { quote = c; current += c; }
      else if (c === ",") { out.push(current.trim()); current = ""; }
      else current += c;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  }
  function parseLine(text, line) {
    let source = stripComment(text).trim();
    if (!source) return null;
    let label = null;
    const colon = source.match(/^([A-Za-z_.$][\w.$]*):\s*(.*)$/);
    if (colon) { label = colon[1].toUpperCase(); source = colon[2].trim(); }
    const equ = source.match(/^([A-Za-z_.$][\w.$]*)\s+EQU\s+(.+)$/i);
    if (equ) return { label: equ[1].toUpperCase(), op: "EQU", args: [equ[2].trim()], line };
    const pieces = source.match(/^(\S+)(?:\s+(.*))?$/);
    if (!pieces) return null;
    let op = pieces[1].toUpperCase(), rest = pieces[2] || "";
    if (!label && !/^(?:ORG|DB|DW|DS|EQU|MOV|MVI|LXI|STAX|LDAX|SHLD|LHLD|STA|LDA|XCHG|ADD|ADC|SUB|SBB|ANA|XRA|ORA|CMP|ADI|ACI|SUI|SBI|ANI|XRI|ORI|CPI|INR|DCR|INX|DCX|DAD|RLC|RRC|RAL|RAR|DAA|CMA|STC|CMC|JMP|JNZ|JZ|JNC|JC|JPO|JPE|JP|JM|CALL|CNZ|CZ|CNC|CC|CPO|CPE|CP|CM|RET|RNZ|RZ|RNC|RC|RPO|RPE|RP|RM|RST|PUSH|POP|PCHL|SPHL|XTHL|XCHG|EI|DI|HLT|NOP|IN|OUT|RIM|SIM)$/.test(op)) {
      const candidate = source.match(/^([A-Za-z_.$][\w.$]*)\s+(.+)$/);
      if (candidate) { label = candidate[1].toUpperCase(); source = candidate[2]; }
      const next = source.match(/^(\S+)(?:\s+(.*))?$/);
      op = next[1].toUpperCase(); rest = next[2] || "";
    }
    return { label, op, args: splitArgs(rest), line };
  }

  const FIXED = {
    NOP: 0x00, RLC: 0x07, RRC: 0x0f, RAL: 0x17, RAR: 0x1f,
    DAA: 0x27, CMA: 0x2f, STC: 0x37, CMC: 0x3f,
    RET: 0xc9, PCHL: 0xe9, SPHL: 0xf9, XTHL: 0xe3, XCHG: 0xeb,
    DI: 0xf3, EI: 0xfb, HLT: 0x76, RIM: 0x20, SIM: 0x30,
  };
  const COND_OPS = {
    JMP: [0xc3, "jump"], JNZ: [0xc2, "jump", "NZ"], JZ: [0xca, "jump", "Z"],
    JNC: [0xd2, "jump", "NC"], JC: [0xda, "jump", "C"], JPO: [0xe2, "jump", "PO"],
    JPE: [0xea, "jump", "PE"], JP: [0xf2, "jump", "P"], JM: [0xfa, "jump", "M"],
    CALL: [0xcd, "call"], CNZ: [0xc4, "call", "NZ"], CZ: [0xcc, "call", "Z"],
    CNC: [0xd4, "call", "NC"], CC: [0xdc, "call", "C"], CPO: [0xe4, "call", "PO"],
    CPE: [0xec, "call", "PE"], CP: [0xf4, "call", "P"], CM: [0xfc, "call", "M"],
    RET: [0xc9, "ret"], RNZ: [0xc0, "ret", "NZ"], RZ: [0xc8, "ret", "Z"],
    RNC: [0xd0, "ret", "NC"], RC: [0xd8, "ret", "C"], RPO: [0xe0, "ret", "PO"],
    RPE: [0xe8, "ret", "PE"], RP: [0xf0, "ret", "P"], RM: [0xf8, "ret", "M"],
  };
  const BYTE_CODES = { ADI: 0xc6, ACI: 0xce, SUI: 0xd6, SBI: 0xde, ANI: 0xe6, XRI: 0xee, ORI: 0xf6, CPI: 0xfe };

  function instructionSize(op, args, line) {
    if (op === "DB") return args.reduce((sum, arg) => sum + (arg.length >= 2 && /^(['"]).*\1$/.test(arg) ? arg.length - 2 : 1), 0);
    if (op === "DW") return args.length * 2;
    if (op === "DS") return args.length === 1 ? 0 : 0;
    if (["ORG", "EQU"].includes(op)) return 0;
    if (FIXED[op] !== undefined || op === "PUSH" || op === "POP" || op === "RST" || op === "STAX" || op === "LDAX" || op === "IN" || op === "OUT") return 1 + ((op === "IN" || op === "OUT") ? 1 : 0);
    if (["MVI"].includes(op) || BYTE_CODES[op] !== undefined) return 2;
    if (["LXI", "SHLD", "LHLD", "STA", "LDA"].includes(op) || COND_OPS[op]?.[1] === "jump" || COND_OPS[op]?.[1] === "call") return 3;
    if (COND_OPS[op]?.[1] === "ret" || ["MOV", "INR", "DCR", "INX", "DCX", "DAD", "ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"].includes(op)) return 1;
    throw new AssemblerError(line, `تعليمة غير معروفة: ${op}`);
  }
  function assertArgs(args, count, line) {
    if (args.length !== count) throw new AssemblerError(line, `عدد المعاملات غير صحيح؛ المتوقع ${count}`);
  }
  function regCode(name, line) {
    const value = REGISTERS.indexOf(name.toUpperCase());
    if (value < 0) throw new AssemblerError(line, `مسجل غير صالح: ${name}`);
    return value;
  }
  function pairCode(name, line, allowPsw) {
    const value = PAIRS.indexOf(name.toUpperCase());
    if (value >= 0) return value;
    if (allowPsw && name.toUpperCase() === "PSW") return 3;
    throw new AssemblerError(line, `زوج مسجلات غير صالح: ${name}`);
  }
  function encode(item, symbols, pc) {
    const { op, args, line } = item, bytes = [];
    const value = (arg, max) => {
      const n = parseNumber(arg, symbols, line);
      if (n < 0 || n > max) throw new AssemblerError(line, `القيمة ${arg} خارج النطاق`);
      return n;
    };
    const emit16 = (n) => { bytes.push(n & 255, (n >> 8) & 255); };
    const one = (code) => { bytes.push(code); };
    if (op === "DB" || op === "DW") {
      if (!args.length) throw new AssemblerError(line, `${op} يحتاج قيمة واحدة على الأقل`);
      for (const arg of args) {
        if (op === "DB" && /^(['"]).*\1$/.test(arg)) {
          for (const char of arg.slice(1, -1)) bytes.push(char.charCodeAt(0) & 255);
        } else {
          const n = value(arg, op === "DB" ? 0xff : 0xffff);
          if (op === "DB") bytes.push(n); else emit16(n);
        }
      }
      return bytes;
    }
    if (op === "DS") return [];
    if (FIXED[op] !== undefined) { assertArgs(args, 0, line); one(FIXED[op]); return bytes; }
    if (op === "ORG" || op === "EQU") return bytes;
    if (op === "MOV") {
      assertArgs(args, 2, line);
      const d = regCode(args[0], line), s = regCode(args[1], line);
      if (d === 6 && s === 6) throw new AssemblerError(line, "MOV M,M هو ترميز HLT وليس تعليمة MOV صالحة");
      one(0x40 | (d << 3) | s); return bytes;
    }
    if (op === "MVI") { assertArgs(args, 2, line); one(0x06 | (regCode(args[0], line) << 3)); bytes.push(value(args[1], 255)); return bytes; }
    if (op === "LXI") { assertArgs(args, 2, line); one(0x01 | (pairCode(args[0], line, false) << 4)); emit16(value(args[1], 65535)); return bytes; }
    if (["STAX", "LDAX"].includes(op)) {
      assertArgs(args, 1, line);
      const p = args[0].toUpperCase();
      if (p !== "B" && p !== "D") throw new AssemblerError(line, `${op} يقبل B أو D فقط`);
      one((op === "STAX" ? 0x02 : 0x0a) + (p === "D" ? 0x10 : 0)); return bytes;
    }
    if (["SHLD", "LHLD", "STA", "LDA"].includes(op)) {
      assertArgs(args, 1, line); one(({ SHLD: 0x22, LHLD: 0x2a, STA: 0x32, LDA: 0x3a })[op]);
      emit16(value(args[0], 65535)); return bytes;
    }
    if (["IN", "OUT"].includes(op)) { assertArgs(args, 1, line); one(op === "IN" ? 0xdb : 0xd3); bytes.push(value(args[0], 255)); return bytes; }
    if (["INR", "DCR"].includes(op)) { assertArgs(args, 1, line); one((op === "INR" ? 0x04 : 0x05) | (regCode(args[0], line) << 3)); return bytes; }
    if (["INX", "DCX", "DAD"].includes(op)) {
      assertArgs(args, 1, line); const p = pairCode(args[0], line, op !== "DAD");
      one(({ INX: 0x03, DCX: 0x0b, DAD: 0x09 })[op] | (p << 4)); return bytes;
    }
    if (ALU_NAMES.includes(op)) { assertArgs(args, 1, line); one(0x80 | (ALU_NAMES.indexOf(op) << 3) | regCode(args[0], line)); return bytes; }
    if (BYTE_CODES[op] !== undefined) { assertArgs(args, 1, line); one(BYTE_CODES[op]); bytes.push(value(args[0], 255)); return bytes; }
    if (["PUSH", "POP"].includes(op)) { assertArgs(args, 1, line); one((op === "PUSH" ? 0xc5 : 0xc1) | (pairCode(args[0], line, true) << 4)); return bytes; }
    if (op === "RST") { assertArgs(args, 1, line); const n = value(args[0], 7); one(0xc7 | (n << 3)); return bytes; }
    if (COND_OPS[op]) {
      const [code, kind] = COND_OPS[op]; assertArgs(args, kind === "ret" ? 0 : 1, line); one(code);
      if (kind !== "ret") emit16(value(args[0], 65535));
      return bytes;
    }
    throw new AssemblerError(line, `تعليمة غير مدعومة: ${op}`);
  }

  function assemble(source) {
    const lines = source.split(/\r?\n/), items = [];
    lines.forEach((text, index) => {
      const item = parseLine(text, index + 1);
      if (item) items.push(item);
    });
    const symbols = Object.create(null);
    let pc = 0;
    for (const item of items) {
      if (item.op === "EQU") {
        if (!item.label) throw new AssemblerError(item.line, "EQU يحتاج اسماً");
        symbols[item.label] = parseNumber(item.args[0], symbols, item.line);
        continue;
      }
      if (item.op === "ORG") {
        assertArgs(item.args, 1, item.line);
        pc = parseNumber(item.args[0], symbols, item.line);
        if (pc < 0 || pc > 0xffff) throw new AssemblerError(item.line, "عنوان ORG خارج نطاق الذاكرة");
        continue;
      }
      if (item.label) {
        if (Object.prototype.hasOwnProperty.call(symbols, item.label)) throw new AssemblerError(item.line, `الاسم مكرر: ${item.label}`);
        symbols[item.label] = pc;
      }
      if (item.op === "DS") {
        assertArgs(item.args, 1, item.line);
        const n = parseNumber(item.args[0], symbols, item.line);
        if (n < 0 || n > 65536) throw new AssemblerError(item.line, "حجم DS خارج النطاق");
        item.reserve = n; pc += n;
      } else pc += instructionSize(item.op, item.args, item.line);
      if (pc > 65536) throw new AssemblerError(item.line, "تجاوز البرنامج مساحة الذاكرة 64KB");
    }
    const bytes = new Uint8Array(65536), occupied = new Uint8Array(65536), listing = [];
    pc = 0;
    for (const item of items) {
      if (item.op === "EQU") continue;
      if (item.op === "ORG") { pc = parseNumber(item.args[0], symbols, item.line); continue; }
      if (item.op === "DS") {
        const length = item.reserve || 0;
        listing.push({ address: pc, bytes: [], text: lines[item.line - 1].trim(), line: item.line, reserve: length });
        for (let i = 0; i < length; i++) occupied[(pc + i) & 0xffff] = 1;
        pc = (pc + length) & 0xffff;
        continue;
      }
      const encoded = encode(item, symbols, pc);
      if (pc + encoded.length > 65536) throw new AssemblerError(item.line, "تجاوز البرنامج مساحة الذاكرة 64KB");
      for (let i = 0; i < encoded.length; i++) {
        const address = pc + i;
        if (occupied[address]) throw new AssemblerError(item.line, `تداخل في العنوان ${hex(address, 4)}`);
        bytes[address] = encoded[i]; occupied[address] = 1;
      }
      listing.push({ address: pc, bytes: encoded, text: lines[item.line - 1].trim(), line: item.line });
      pc += encoded.length;
    }
    const entry = listing.find((row) => row.bytes.length && row.bytes.some(() => true));
    return { memory: bytes, occupied, listing, symbols, entry: entry ? entry.address : 0 };
  }

  class CPU8085 {
    constructor() { this.reset(); }
    reset() {
      this.memory = new Uint8Array(65536);
      this.ports = new Uint8Array(256);
      this.reg = { A: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0 };
      this.flags = { S: false, Z: false, AC: false, P: false, CY: false };
      this.PC = 0; this.SP = 0xffff; this.halted = false; this.interruptsEnabled = false;
      this.eiDelay = 0;
      this.interruptMasks = { 7.5: false, 6.5: false, 5.5: false };
      this.pendingInterrupts = { 7.5: false, 6.5: false, 5.5: false };
      this.sid = 0; this.sod = 0; this.instructionCount = 0;
    }
    load(program) {
      this.reset();
      this.memory.set(program.memory);
      this.PC = program.entry & 0xffff;
    }
    pair(name) {
      if (name === "SP") return this.SP;
      const low = { B: "C", D: "E", H: "L" }[name];
      return ((this.reg[name] << 8) | this.reg[low]) & 0xffff;
    }
    setPair(name, value) {
      value &= 0xffff;
      if (name === "SP") this.SP = value;
      else { this.reg[name] = value >> 8; this.reg[{ B: "C", D: "E", H: "L" }[name]] = value & 255; }
    }
    readReg(index) { return index === 6 ? this.memory[this.pair("H")] : this.reg[REGISTERS[index]]; }
    writeReg(index, value) {
      value &= 255;
      if (index === 6) this.memory[this.pair("H")] = value;
      else this.reg[REGISTERS[index]] = value;
    }
    fetch8() { const n = this.memory[this.PC]; this.PC = (this.PC + 1) & 0xffff; return n; }
    fetch16() { const lo = this.fetch8(), hi = this.fetch8(); return lo | (hi << 8); }
    setSZP(value) {
      value &= 255; this.flags.S = !!(value & 0x80); this.flags.Z = value === 0; this.flags.P = parity(value);
    }
    push(value) {
      this.SP = (this.SP - 1) & 0xffff; this.memory[this.SP] = (value >> 8) & 255;
      this.SP = (this.SP - 1) & 0xffff; this.memory[this.SP] = value & 255;
    }
    pop() { const lo = this.memory[this.SP]; this.SP = (this.SP + 1) & 0xffff; const hi = this.memory[this.SP]; this.SP = (this.SP + 1) & 0xffff; return lo | (hi << 8); }
    pushPSW() { this.push((this.reg.A << 8) | (this.flags.S ? 0x80 : 0) | (this.flags.Z ? 0x40 : 0) | (this.flags.AC ? 0x10 : 0) | (this.flags.P ? 4 : 0) | 2 | (this.flags.CY ? 1 : 0)); }
    popPSW(value) {
      this.reg.A = (value >> 8) & 255;
      this.flags.S = !!(value & 0x80); this.flags.Z = !!(value & 0x40);
      this.flags.AC = !!(value & 0x10); this.flags.P = !!(value & 4); this.flags.CY = !!(value & 1);
    }
    alu(operation, operand) {
      const a = this.reg.A, carry = (operation === 1 || operation === 3) && this.flags.CY ? 1 : 0;
      let result;
      if (operation <= 3) {
        const subtract = operation >= 2, rhs = operand + carry;
        result = subtract ? a - rhs : a + rhs;
        this.flags.CY = subtract ? a < rhs : result > 255;
        this.flags.AC = subtract ? (a & 15) < ((operand & 15) + carry) : ((a & 15) + (operand & 15) + carry) > 15;
      } else {
        if (operation === 4) { result = a & operand; this.flags.AC = true; }
        else if (operation === 5) { result = a ^ operand; this.flags.AC = false; }
        else if (operation === 6) { result = a | operand; this.flags.AC = false; }
        else {
          result = a - operand; this.flags.CY = a < operand; this.flags.AC = (a & 15) < (operand & 15);
        }
        if (operation >= 4 && operation <= 6) this.flags.CY = false;
      }
      const byte = result & 255;
      this.setSZP(byte);
      if (operation !== 7) this.reg.A = byte;
    }
    condition(code) {
      const flags = [!this.flags.Z, this.flags.Z, !this.flags.CY, this.flags.CY, !this.flags.P, this.flags.P, !this.flags.S, this.flags.S];
      return flags[code];
    }
    step() {
      if (this.halted) return { halted: true, pc: this.PC, opcode: null };
      const start = this.PC, beforeRegisters = { ...this.reg }, beforeFlags = { ...this.flags }, beforeSP = this.SP;
      const op = this.fetch8();
      const r = op & 7, d = (op >> 3) & 7, pair = (op >> 4) & 3;
      let name = "???";
      let flow = null;
      if (op === 0x00) name = "NOP";
      else if (op === 0x76) { this.halted = true; name = "HLT"; }
      else if (op >= 0x40 && op <= 0x7f) {
        const value = this.readReg(r), address = r === 6 || d === 6 ? this.pair("H") : null;
        this.writeReg(d, value); name = `MOV ${REGISTERS[d]},${REGISTERS[r]}`;
        flow = r === 6
          ? { from: "memory", to: "registers", action: `قراءة ${hex(value)}H إلى ${REGISTERS[d]}`, value, address }
          : d === 6
            ? { from: "registers", to: "memory", action: `تخزين ${hex(value)}H من ${REGISTERS[r]}`, value, address }
            : { from: "registers", to: "registers", action: `نسخ ${REGISTERS[r]} إلى ${REGISTERS[d]}`, value };
      }
      else if (op >= 0x80 && op <= 0xbf) {
        const operand = this.readReg(r), oldA = this.reg.A;
        this.alu(d, operand); name = `${ALU_NAMES[d]} ${REGISTERS[r]}`;
        flow = { from: r === 6 ? "memory" : "registers", to: d === 7 ? "registers" : "cpu",
          action: `${ALU_NAMES[d]}: ${hex(oldA)}H ${d < 4 ? "+" : "عملية"} ${hex(operand)}H${d === 7 ? " ← تحديث الأعلام" : ` = ${hex(this.reg.A)}H`}`,
          value: d === 7 ? operand : this.reg.A, address: r === 6 ? this.pair("H") : null };
      }
      else if ((op & 0xc7) === 0x06) {
        const value = this.fetch8(); this.writeReg(d, value); name = `MVI ${REGISTERS[d]}`;
        flow = { from: "program", to: d === 6 ? "memory" : "registers", action: `تحميل ${hex(value)}H إلى ${REGISTERS[d]}`, value, address: d === 6 ? this.pair("H") : null };
      }
      else if ((op & 0xcf) === 0x01) {
        const value = this.fetch16(); this.setPair(PAIRS[pair], value); name = `LXI ${PAIRS[pair]}`;
        flow = { from: "program", to: "registers", action: `تحميل ${hex(value, 4)}H إلى ${PAIRS[pair]}`, value };
      }
      else if ((op & 0xcf) === 0x03) { this.setPair(PAIRS[pair], this.pair(PAIRS[pair]) + 1); name = `INX ${PAIRS[pair]}`; }
      else if ((op & 0xcf) === 0x0b) { this.setPair(PAIRS[pair], this.pair(PAIRS[pair]) - 1); name = `DCX ${PAIRS[pair]}`; }
      else if ((op & 0xcf) === 0x09) {
        const result = this.pair("H") + this.pair(PAIRS[pair]); this.flags.CY = result > 0xffff; this.setPair("H", result); name = `DAD ${PAIRS[pair]}`;
      } else if ((op & 0xc7) === 0x04) {
        const old = this.readReg(d), result = (old + 1) & 255; this.flags.AC = (old & 15) === 15; this.setSZP(result); this.writeReg(d, result); name = `INR ${REGISTERS[d]}`;
        if (d === 6) flow = { from: "memory", to: "memory", action: `تحديث بايت الذاكرة عند ${hex(this.pair("H"), 4)}H إلى ${hex(result)}H`, value: result, address: this.pair("H") };
      } else if ((op & 0xc7) === 0x05) {
        const old = this.readReg(d), result = (old - 1) & 255; this.flags.AC = (old & 15) === 0; this.setSZP(result); this.writeReg(d, result); name = `DCR ${REGISTERS[d]}`;
        if (d === 6) flow = { from: "memory", to: "memory", action: `تحديث بايت الذاكرة عند ${hex(this.pair("H"), 4)}H إلى ${hex(result)}H`, value: result, address: this.pair("H") };
      } else if (op === 0x02 || op === 0x12) {
        const address = this.pair(op === 0x02 ? "B" : "D"), value = this.reg.A;
        this.memory[address] = value; name = "STAX";
        flow = { from: "registers", to: "memory", action: `تخزين A = ${hex(value)}H في الذاكرة`, value, address };
      }
      else if (op === 0x0a || op === 0x1a) {
        const address = this.pair(op === 0x0a ? "B" : "D"), value = this.memory[address];
        this.reg.A = value; name = "LDAX";
        flow = { from: "memory", to: "registers", action: `قراءة ${hex(value)}H من الذاكرة إلى A`, value, address };
      }
      else if (op === 0x22 || op === 0x2a || op === 0x32 || op === 0x3a) {
        const addr = this.fetch16();
        if (op === 0x22) {
          this.memory[addr] = this.reg.L; this.memory[(addr + 1) & 0xffff] = this.reg.H; name = "SHLD";
          flow = { from: "registers", to: "memory", action: `تخزين HL = ${hex(this.pair("H"), 4)}H ابتداءً من الذاكرة`, value: this.pair("H"), address: addr, width: 2 };
        } else if (op === 0x2a) {
          this.reg.L = this.memory[addr]; this.reg.H = this.memory[(addr + 1) & 0xffff]; name = "LHLD";
          flow = { from: "memory", to: "registers", action: `تحميل HL = ${hex(this.pair("H"), 4)}H من الذاكرة`, value: this.pair("H"), address: addr, width: 2 };
        } else if (op === 0x32) {
          this.memory[addr] = this.reg.A; name = "STA";
          flow = { from: "registers", to: "memory", action: `تخزين A = ${hex(this.reg.A)}H في الذاكرة`, value: this.reg.A, address: addr };
        } else {
          this.reg.A = this.memory[addr]; name = "LDA";
          flow = { from: "memory", to: "registers", action: `تحميل A = ${hex(this.reg.A)}H من الذاكرة`, value: this.reg.A, address: addr };
        }
      } else if (op === 0x07 || op === 0x0f || op === 0x17 || op === 0x1f) {
        const a = this.reg.A, oldCarry = this.flags.CY;
        if (op === 0x07) { this.flags.CY = !!(a & 0x80); this.reg.A = ((a << 1) | (a >> 7)) & 255; name = "RLC"; }
        else if (op === 0x0f) { this.flags.CY = !!(a & 1); this.reg.A = ((a >> 1) | (a << 7)) & 255; name = "RRC"; }
        else if (op === 0x17) { this.flags.CY = !!(a & 0x80); this.reg.A = ((a << 1) | (oldCarry ? 1 : 0)) & 255; name = "RAL"; }
        else { this.flags.CY = !!(a & 1); this.reg.A = ((a >> 1) | (oldCarry ? 0x80 : 0)) & 255; name = "RAR"; }
      } else if (op === 0x27) {
        const old = this.reg.A, carry = this.flags.CY;
        let correction = 0;
        if ((old & 15) > 9 || this.flags.AC) correction |= 0x06;
        if (old > 0x99 || carry) correction |= 0x60;
        const result = old + correction;
        this.flags.AC = ((old & 15) + (correction & 15)) > 15;
        this.flags.CY = carry || result > 255; this.reg.A = result & 255; this.setSZP(this.reg.A); name = "DAA";
      } else if (op === 0x2f) { this.reg.A ^= 255; name = "CMA"; }
      else if (op === 0x37) { this.flags.CY = true; name = "STC"; }
      else if (op === 0x3f) { this.flags.CY = !this.flags.CY; name = "CMC"; }
      else if (op === 0xc3 || op === 0xcd || ((op & 0xc7) === 0xc2) || ((op & 0xc7) === 0xc4)) {
        const addr = this.fetch16(), isCall = op === 0xcd || (op & 0xc7) === 0xc4;
        const take = op === 0xc3 || op === 0xcd || this.condition((op >> 3) & 7);
        if (take) {
          if (isCall) {
            const returnAddress = this.PC;
            this.push(returnAddress);
            flow = { from: "cpu", to: "stack", action: `حفظ عنوان العودة ${hex(returnAddress, 4)}H`, value: returnAddress, address: this.SP, width: 2 };
          } else flow = { from: "program", to: "cpu", action: `قفز إلى العنوان ${hex(addr, 4)}H`, value: addr, address: addr, width: 2 };
          this.PC = addr;
        }
        name = isCall ? "CALL" : "JMP";
      } else if (op === 0xc9 || ((op & 0xc7) === 0xc0)) {
        const take = op === 0xc9 || this.condition((op >> 3) & 7);
        if (take) {
          const address = this.SP, target = this.pop(); this.PC = target;
          flow = { from: "stack", to: "cpu", action: `سحب عنوان العودة ${hex(target, 4)}H`, value: target, address, width: 2 };
        }
        name = "RET";
      } else if ((op & 0xcf) === 0xc5) {
        const p = pair === 3 ? null : PAIRS[pair];
        const value = p ? this.pair(p) : ((this.reg.A << 8) | (this.flags.S ? 0x80 : 0) | (this.flags.Z ? 0x40 : 0) | (this.flags.AC ? 0x10 : 0) | (this.flags.P ? 4 : 0) | 2 | (this.flags.CY ? 1 : 0));
        if (p) this.push(value); else this.pushPSW();
        flow = { from: "registers", to: "stack", action: `دفع ${p || "PSW"} = ${hex(value, 4)}H إلى المكدس`, value, address: this.SP, width: 2 };
        name = "PUSH";
      } else if ((op & 0xcf) === 0xc1) {
        const value = this.pop(), p = pair === 3 ? null : PAIRS[pair];
        if (p) this.setPair(p, value); else this.popPSW(value);
        flow = { from: "stack", to: "registers", action: `سحب ${hex(value, 4)}H إلى ${p || "PSW"}`, value, address: (this.SP - 2) & 0xffff, width: 2 };
        name = "POP";
      } else if ((op & 0xc7) === 0xc7) {
        const address = (this.SP - 2) & 0xffff, value = this.PC;
        this.push(value); this.PC = op & 0x38; name = "RST";
        flow = { from: "cpu", to: "stack", action: `حفظ عنوان العودة ${hex(value, 4)}H`, value, address, width: 2 };
      }
      else if (op === 0xe3) {
        const addr = this.SP, lo = this.memory[addr], hi = this.memory[(addr + 1) & 0xffff];
        this.memory[addr] = this.reg.L; this.memory[(addr + 1) & 0xffff] = this.reg.H;
        this.reg.L = lo; this.reg.H = hi; name = "XTHL";
        flow = { from: "stack", to: "registers", action: `تبادل HL مع الكلمة عند SP = ${hex(addr, 4)}H`, value: (hi << 8) | lo, address: addr, width: 2 };
      } else if (op === 0xe9) {
        this.PC = this.pair("H"); name = "PCHL";
        flow = { from: "registers", to: "cpu", action: `تحميل PC من HL = ${hex(this.PC, 4)}H`, value: this.PC, address: this.PC, width: 2 };
      }
      else if (op === 0xeb) {
        [this.reg.D, this.reg.H] = [this.reg.H, this.reg.D];
        [this.reg.E, this.reg.L] = [this.reg.L, this.reg.E]; name = "XCHG";
      } else if (op === 0xf9) { this.SP = this.pair("H"); name = "SPHL"; }
      else if (BYTE_CODES && Object.values(BYTE_CODES).includes(op)) {
        const value = this.fetch8(), code = Object.values(BYTE_CODES).indexOf(op), oldA = this.reg.A;
        this.alu(code, value); name = ALU_IMM[code];
        flow = { from: "program", to: "registers",
          action: `${ALU_IMM[code]}: ${hex(oldA)}H مع ${hex(value)}H${code === 7 ? " ← تحديث الأعلام" : ` = ${hex(this.reg.A)}H`}`,
          value: code === 7 ? value : this.reg.A };
      } else if (op === 0xdb) {
        const port = this.fetch8(); this.reg.A = this.ports[port]; name = "IN";
        flow = { from: "ports", to: "registers", action: `قراءة المنفذ ${hex(port)}H = ${hex(this.reg.A)}H إلى A`, value: this.reg.A, address: port };
      }
      else if (op === 0xd3) {
        const port = this.fetch8(); this.ports[port] = this.reg.A; name = "OUT";
        flow = { from: "registers", to: "ports", action: `إرسال A = ${hex(this.reg.A)}H إلى المنفذ ${hex(port)}H`, value: this.reg.A, address: port };
      }
      else if (op === 0xf3) { this.interruptsEnabled = false; this.eiDelay = 0; name = "DI"; }
      else if (op === 0xfb) { this.eiDelay = 2; name = "EI"; }
      else if (op === 0x20) {
        this.reg.A = (this.sid ? 0x80 : 0) | (this.interruptsEnabled ? 0x08 : 0)
          | (this.pendingInterrupts[6.5] ? 0x40 : 0) | (this.pendingInterrupts[5.5] ? 0x20 : 0)
          | (this.pendingInterrupts[7.5] ? 0x10 : 0)
          | (this.interruptMasks[7.5] ? 0x04 : 0) | (this.interruptMasks[6.5] ? 0x02 : 0)
          | (this.interruptMasks[5.5] ? 0x01 : 0);
        name = "RIM";
      } else if (op === 0x30) {
        const a = this.reg.A;
        if (a & 0x08) {
          this.interruptMasks[7.5] = !!(a & 0x04); this.interruptMasks[6.5] = !!(a & 0x02); this.interruptMasks[5.5] = !!(a & 0x01);
        }
        if (a & 0x10) this.pendingInterrupts[7.5] = false;
        if (a & 0x80) this.sod = (a >> 6) & 1;
        name = "SIM";
      } else {
        throw new Error(`تعليمة غير معرّفة عند العنوان ${hex(start, 4)}: ${hex(op)}`);
      }
      if (!flow) {
        const changedRegisters = Object.keys(this.reg).filter((key) => beforeRegisters[key] !== this.reg[key]);
        const changedFlags = Object.keys(this.flags).filter((key) => beforeFlags[key] !== this.flags[key]);
        if (changedRegisters.length || changedFlags.length || beforeSP !== this.SP) {
          flow = {
            from: "registers",
            to: "registers",
            value: changedRegisters.length === 1 ? this.reg[changedRegisters[0]] : undefined,
            changes: { registers: changedRegisters, flags: changedFlags, stackPointer: beforeSP !== this.SP },
          };
        } else {
          flow = { from: "program", to: "cpu", action: "Fetched instruction", value: op, address: start };
        }
      }
      if (this.eiDelay > 0) {
        this.eiDelay--;
        if (this.eiDelay === 0) this.interruptsEnabled = true;
      }
      this.instructionCount++;
      return { halted: this.halted, pc: start, nextPC: this.PC, opcode: op, name, flow };
    }
  }

  function disassemble(memory, address) {
    const op = memory[address & 0xffff], next = memory[(address + 1) & 0xffff], hi = memory[(address + 2) & 0xffff];
    if (op >= 0x40 && op <= 0x7f) return { text: op === 0x76 ? "HLT" : `MOV ${REGISTERS[(op >> 3) & 7]},${REGISTERS[op & 7]}`, size: 1 };
    if (op >= 0x80 && op <= 0xbf) return { text: `${ALU_NAMES[(op >> 3) & 7]} ${REGISTERS[op & 7]}`, size: 1 };
    if ((op & 0xc7) === 0x06) return { text: `MVI ${REGISTERS[(op >> 3) & 7]},${hex(next)}H`, size: 2 };
    if ((op & 0xcf) === 0x01) return { text: `LXI ${PAIRS[(op >> 4) & 3]},${hex(next | (hi << 8), 4)}H`, size: 3 };
    if ((op & 0xc7) === 0x04) return { text: `INR ${REGISTERS[(op >> 3) & 7]}`, size: 1 };
    if ((op & 0xc7) === 0x05) return { text: `DCR ${REGISTERS[(op >> 3) & 7]}`, size: 1 };
    if ((op & 0xcf) === 0x03) return { text: `INX ${PAIRS[(op >> 4) & 3]}`, size: 1 };
    if ((op & 0xcf) === 0x0b) return { text: `DCX ${PAIRS[(op >> 4) & 3]}`, size: 1 };
    if ((op & 0xcf) === 0x09) return { text: `DAD ${PAIRS[(op >> 4) & 3]}`, size: 1 };
    if ([0xc3, 0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa, 0xcd, 0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc, 0x22, 0x2a, 0x32, 0x3a].includes(op)) {
      const labels = { 0xc3: "JMP", 0xc2: "JNZ", 0xca: "JZ", 0xd2: "JNC", 0xda: "JC", 0xe2: "JPO", 0xea: "JPE", 0xf2: "JP", 0xfa: "JM", 0xcd: "CALL", 0xc4: "CNZ", 0xcc: "CZ", 0xd4: "CNC", 0xdc: "CC", 0xe4: "CPO", 0xec: "CPE", 0xf4: "CP", 0xfc: "CM", 0x22: "SHLD", 0x2a: "LHLD", 0x32: "STA", 0x3a: "LDA" };
      return { text: `${labels[op]} ${hex(next | (hi << 8), 4)}H`, size: 3 };
    }
    if (Object.prototype.hasOwnProperty.call(FIXED, Object.keys(FIXED).find((key) => FIXED[key] === op))) return { text: Object.keys(FIXED).find((key) => FIXED[key] === op), size: 1 };
    return { text: `DB ${hex(op)}H`, size: 1 };
  }

  return { CPU8085, assemble, AssemblerError, disassemble, hex, parity };
});
