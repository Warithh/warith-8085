(function (root) {
  "use strict";
  const KEY = "warith-8085-lab";

  function encode(bytes) {
    let text = "";
    for (let index = 0; index < bytes.length; index += 8192) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + 8192));
    }
    return btoa(text);
  }
  function decode(text, length) {
    const binary = atob(text);
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length && index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  function pack(cpu, extra) {
    return JSON.stringify({
      v: 1,
      pc: cpu.PC & 0xffff,
      sp: cpu.SP & 0xffff,
      reg: { ...cpu.reg },
      flags: { ...cpu.flags },
      ie: cpu.interruptsEnabled,
      masks: { ...cpu.interruptMasks },
      halted: cpu.halted,
      count: cpu.instructionCount,
      memory: encode(cpu.memory),
      ports: encode(cpu.ports),
      view: (extra.view ?? cpu.PC) & 0xffff,
      entry: (extra.entry ?? cpu.PC) & 0xffff,
    });
  }
  function unpack(raw) {
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || typeof data.memory !== "string" || typeof data.ports !== "string") return null;
    return data;
  }
  function apply(cpu, data) {
    cpu.memory.set(decode(data.memory, 65536));
    cpu.ports.set(decode(data.ports, 256));
    Object.assign(cpu.reg, data.reg);
    Object.assign(cpu.flags, data.flags);
    cpu.PC = data.pc & 0xffff;
    cpu.SP = data.sp & 0xffff;
    cpu.interruptsEnabled = Boolean(data.ie);
    Object.assign(cpu.interruptMasks, data.masks || {});
    cpu.halted = Boolean(data.halted);
    cpu.instructionCount = data.count || 0;
    return data;
  }
  async function read() {
    try {
      if (root.desktopBridge && root.desktopBridge.readLabState) {
        return unpack(await root.desktopBridge.readLabState());
      }
      return unpack(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  }
  async function write(cpu, extra) {
    const text = pack(cpu, extra || {});
    try {
      if (root.desktopBridge && root.desktopBridge.writeLabState) await root.desktopBridge.writeLabState(text);
      else localStorage.setItem(KEY, text);
    } catch {
      /* The browser can refuse an oversized store. The open page still keeps its copy. */
    }
  }
  root.LabState = { read, write, apply };
})(globalThis);
