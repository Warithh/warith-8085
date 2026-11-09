(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const cpu = new I8085.CPU8085();
  const text = {
    en: {
      brand: "WARITH 8085", brandSub: "Microprocessor learning lab", offline: "Runs locally · No internet required", desktopApp: "Desktop app",
      eyebrow: "INTERACTIVE LEARNING LAB", headline: "Understand the", introText: "Write a program, execute it step by step, and watch data move through the processor.",
      architecture: "bit · 64 KB memory", program: "PROGRAM", editorTitle: "Assembly editor", examples: "Examples",
      sampleSum: "Add two numbers", sampleLoop: "Countdown loop", sampleMemory: "Read and write memory", sampleStack: "Use the stack",
      assemble: "Assemble", step: "Step", run: "Run", pause: "Pause", reset: "Reset", speed: "Speed", instructionsPerTick: "instruction / tick",
      initialStatus: "Choose an example or write a program, then assemble it.", state: "STATE", registersTitle: "Processor registers",
      stopped: "Stopped", ready: "Ready", running: "Running", halted: "HALTED", error: "Error", accumulator: "accumulator", flags: "flags",
      programCounter: "program counter", stackPointer: "stack pointer", sign: "Sign", zero: "Zero", auxCarry: "Aux carry",
      parity: "Parity", carry: "Carry", instructionsExecuted: "Instructions executed", memory: "MEMORY", memoryTitle: "Memory inspector",
      address: "Address", memoryHint: "64 KB · hexadecimal bytes", programByte: "Program", currentAddress: "Pointer",
      dataPath: "DATA PATH", flowTitle: "Data movement inside the CPU", waitingExecution: "Ready to execute",
      programMemory: "Program memory", processor: "Processor", registers: "Registers", dataMemory: "Data memory",
      stack: "Stack", ioPorts: "I/O ports", flowDescription: "The CPU fetches an instruction and determines its data path.",
      flowPrompt: "Follow each bus transfer and watch its destination update.", listingTitle: "Instruction listing", notAssembled: "Not assembled",
      listingEmpty: "Addresses and bytes will appear here after assembly.", stackArea: "Stack memory", helpTitle: "Get started in three steps",
      helpText: "Choose an example or write a program, then select Assemble. Use Step to trace each instruction or Run for continuous execution. Register, memory, and data-path changes appear live.",
      directives: "Directives:", directiveHelp: " — hexadecimal values such as 3AH; comments start with ;",
      footer: "Local learning lab", offlineShort: "Offline", labelAddress: "Address",
      assembled: (n, pc) => `Assembled successfully: ${n} bytes · entry point ${pc}H`,
      haltedAt: (pc, n) => `Execution reached HLT at ${pc}H after ${n} instructions.`,
      executedAt: (name, pc, next) => `Executed ${name} at ${pc}H · next PC ${next}H`,
      resetDone: "Processor restored to the program's initial state.", sampleLoaded: "Example loaded. Select Assemble to begin.",
      about: "8085 processor learning simulator. Runs entirely offline.",
      dataRead: (v, a) => `Read ${v}H from memory at ${a}H`, dataWrite: (v, a) => `Stored ${v}H in memory at ${a}H`,
      stackRead: (v, a) => `Popped ${v}H from stack at ${a}H`, stackWrite: (v, a) => `Pushed ${v}H to stack at ${a}H`,
      registerTransfer: (v) => `Transferred ${v}H between registers and CPU`, programTransfer: (v) => `Fetched ${v}H from program memory`,
      instructionAt: (a) => `Instruction at ${a}H`, unknownSymbol: "Unknown symbol or value", operandCount: "Incorrect operand count; expected",
      invalidRegister: "Invalid register", invalidPair: "Invalid register pair", range: "out of range", overlap: "Address overlap",
      unknownInstruction: "Unknown instruction", unsupportedInstruction: "Unsupported instruction", invalidExpression: "Invalid expression",
      duplicateName: "Duplicate name", outOfMemory: "Program exceeds the 64 KB memory space", orgRange: "ORG address is outside memory",
      dsRange: "DS size is out of range", invalidMove: "MOV M,M encodes HLT and is not a valid MOV instruction",
      line: (n, msg) => `Line ${n}: ${msg}`, failure: "Execution error", unknownOpcode: (pc, op) => `Undefined instruction at ${pc}: ${op}`,
    },
  };
  const t = (key, ...args) => {
    const value = text.en[key];
    return typeof value === "function" ? value(...args) : (value ?? key);
  };
  const samples = {
    sum: {
      en: `; Add 25H and 17H, then store the result
        ORG 2000H
        MVI A, 25H
        MVI B, 17H
        ADD B
        STA 3000H
        HLT`,
    },
    loop: {
      en: `; Count down from 05H to zero
        ORG 2000H
        MVI B, 05H
LOOP:   DCR B
        MOV A, B
        JNZ LOOP
        HLT`,
    },
    memory: {
      en: `; Store a word and read it back into HL
        ORG 2000H
        LXI H, 1234H
        SHLD 3000H
        LXI H, 0000H
        LHLD 3000H
        HLT`,
    },
    stack: {
      en: `; Save and restore register pair BC
        ORG 2000H
        LXI SP, 4000H
        LXI B, 1234H
        PUSH B
        LXI B, 0000H
        POP B
        HLT`,
    },
  };
  let program = null, timer = null, lastStep = null, statusFactory = () => t("initialStatus");
  let flowAnimationVersion = 0, flowAnimationPromise = Promise.resolve(), flowAnimating = false, runTickBusy = false;
  let renderedListingProgram = null, renderedListingStep = null, renderedProgramByteCount = 0;
  const source = $("#source");
  source.value = samples.sum.en;
  const sampleName = (id) => t(({ sum: "sampleSum", loop: "sampleLoop", memory: "sampleMemory", stack: "sampleStack" })[id]);
  function applyLanguage() {
    document.documentElement.dir = "ltr";
    document.title = "WARITH 8085";
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    $("#source").setAttribute("aria-label", "8085 assembly editor");
    $("#sampleSelect").setAttribute("aria-label", "Choose a sample");
    $("#memoryAddress").setAttribute("aria-label", "Memory address");
    $("#flowPanel").setAttribute("aria-label", "Execution data path");
    for (const option of $("#sampleSelect").options) option.textContent = sampleName(option.value);
    $("#runBtn").innerHTML = `<span class="button-icon">${timer ? "Ⅱ" : "▶"}</span><span data-i18n="${timer ? "pause" : "run"}">${t(timer ? "pause" : "run")}</span><kbd>F5</kbd>`;
    updateLineNumbers();
    const stateKey = $("#cpuState").dataset.stateKey;
    if (stateKey) setStateKey(stateKey);
    if (lastStep) setFlow(lastStep.flow, false);
    else clearFlow();
    render();
    setStatus(statusFactory());
  }
  function setStatus(message, kind) {
    const element = $("#status");
    statusFactory = typeof message === "function" ? message : () => message;
    element.textContent = statusFactory();
    element.className = `status${kind ? ` ${kind}` : ""}`;
  }
  function setState(label, kind) {
    const element = $("#cpuState");
    element.textContent = label;
    element.className = `state-badge${kind ? ` ${kind}` : ""}`;
  }
  function setStateKey(key, kind) {
    $("#cpuState").dataset.stateKey = key;
    setState(t(key), kind);
  }
  function updateLineNumbers() {
    const activeLine = program && lastStep
      ? program.listing.find((row) => row.address === lastStep.pc)?.line
      : null;
    const numbers = document.createDocumentFragment();
    const lineCount = Math.max(source.value.split("\n").length, 1);
    for (let index = 0; index < lineCount; index++) {
      const line = document.createElement("span");
      line.textContent = String(index + 1);
      if (index + 1 === activeLine) line.className = "current";
      numbers.append(line);
    }
    $("#lineNumbers").replaceChildren(numbers);
  }
  function translateError(error) {
    let message = error.message || String(error);
    const rules = [
      [/^رمز أو قيمة غير معروفة: (.+)$/, (_m, value) => `${t("unknownSymbol")}: ${value}`],
      [/^عدد المعاملات غير صحيح؛ المتوقع (.+)$/, (_m, value) => `${t("operandCount")} ${value}`],
      [/^مسجل غير صالح: (.+)$/, (_m, value) => `${t("invalidRegister")}: ${value}`],
      [/^زوج مسجلات غير صالح: (.+)$/, (_m, value) => `${t("invalidPair")}: ${value}`],
      [/^القيمة (.+) خارج النطاق$/, (_m, value) => `${value} ${t("range")}`],
      [/^تداخل في العنوان (.+)$/, (_m, value) => `${t("overlap")}: ${value}`],
      [/^تعليمة غير معروفة: (.+)$/, (_m, value) => `${t("unknownInstruction")}: ${value}`],
      [/^تعليمة غير مدعومة: (.+)$/, (_m, value) => `${t("unsupportedInstruction")}: ${value}`],
      [/^تعبير غير صالح: (.+)$/, (_m, value) => `${t("invalidExpression")}: ${value}`],
      [/^الاسم مكرر: (.+)$/, (_m, value) => `${t("duplicateName")}: ${value}`],
      [/^تعليمة غير معرّفة عند العنوان (.+): (.+)$/, (_m, pc, opcode) => t("unknownOpcode", pc, opcode)],
    ];
    for (const [pattern, formatter] of rules) {
      const match = message.match(pattern);
      if (match) { message = formatter(...match); break; }
    }
    const exact = {
      "تجاوز البرنامج مساحة الذاكرة 64KB": "outOfMemory",
      "عنوان ORG خارج نطاق الذاكرة": "orgRange",
      "حجم DS خارج النطاق": "dsRange",
      "MOV M,M هو ترميز HLT وليس تعليمة MOV صالحة": "invalidMove",
    };
    if (exact[message]) message = t(exact[message]);
    return error.line ? t("line", error.line, message) : message;
  }
  function flagsByte() {
    const f = cpu.flags;
    return (f.S ? 0x80 : 0) | (f.Z ? 0x40 : 0) | (f.AC ? 0x10 : 0) | (f.P ? 4 : 0) | 2 | (f.CY ? 1 : 0);
  }
  function renderMemory() {
    let address = parseInt($("#memoryAddress").value, 16);
    if (!Number.isFinite(address) || address < 0 || address > 0xffff) address = cpu.PC;
    address &= 0xfff0;
    $("#memoryAddress").value = I8085.hex(address, 4);
    const memory = $("#memoryView");
    if (memory.dataset.baseAddress !== String(address)) {
      memory.replaceChildren();
      memory.dataset.baseAddress = String(address);
      for (let row = 0; row < 8; row++) {
        const base = (address + row * 16) & 0xffff;
        const line = document.createElement("div");
        line.className = "memory-row";
        const addr = document.createElement("span");
        addr.className = "memory-addr";
        addr.textContent = `${I8085.hex(base, 4)}:`;
        const bytes = document.createElement("span");
        bytes.className = "memory-bytes";
        for (let col = 0; col < 16; col++) {
          const value = document.createElement("span");
          value.className = "memory-byte";
          value.dataset.address = String((base + col) & 0xffff);
          bytes.append(value, document.createTextNode(col === 15 ? "" : " "));
        }
        line.append(addr, bytes);
        memory.append(line);
      }
    }
    const flow = lastStep?.flow;
    for (const byte of memory.querySelectorAll(".memory-byte")) {
      const cellAddress = Number(byte.dataset.address);
      byte.textContent = I8085.hex(cpu.memory[cellAddress]);
      byte.classList.toggle("code", !!program?.occupied[cellAddress]);
      byte.classList.toggle("current", cellAddress === cpu.PC);
      byte.classList.toggle("written", (flow?.to === "memory" || flow?.to === "stack")
        && (cellAddress === flow.address || (flow.width === 2 && cellAddress === ((flow.address + 1) & 0xffff))));
    }
  }
  function renderStack() {
    const view = $("#stackView");
    if (view.childElementCount !== 8) {
      view.replaceChildren();
      for (let i = 0; i < 8; i++) {
        const row = document.createElement("div");
        row.className = "stack-row";
        row.append(document.createElement("span"), document.createElement("b"));
        view.append(row);
      }
    }
    $("#stackPointer").textContent = `SP: ${I8085.hex(cpu.SP, 4)}`;
    for (let i = 0; i < 8; i++) {
      const address = (cpu.SP + i) & 0xffff;
      const row = view.children[i];
      row.classList.toggle("active", i === 0);
      row.children[0].textContent = I8085.hex(address, 4);
      row.children[1].textContent = I8085.hex(cpu.memory[address]);
    }
  }
  function renderListing() {
    const container = $("#listing");
    if (!program) {
      if (container.className !== "listing-empty" || renderedListingProgram !== null) {
        container.className = "listing-empty";
        container.textContent = t("listingEmpty");
      }
      renderedListingProgram = null;
      renderedListingStep = null;
      $("#programSize").textContent = t("notAssembled");
      return;
    }
    if (renderedListingProgram !== program) {
      container.className = "listing-scroll";
      const table = document.createElement("table");
      table.className = "listing-table";
      const thead = document.createElement("thead"), heading = document.createElement("tr");
      for (const value of ["Address", "Bytes", "Source"]) {
        const th = document.createElement("th");
        th.textContent = value;
        heading.append(th);
      }
      thead.append(heading);
      const body = document.createElement("tbody");
      for (const row of program.listing) {
        if (!row.bytes.length) continue;
        const tr = document.createElement("tr");
        tr.dataset.address = String(row.address);
        for (const value of [I8085.hex(row.address, 4), row.bytes.map((byte) => I8085.hex(byte)).join(" "), row.text]) {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(thead, body);
      container.replaceChildren(table);
      renderedListingProgram = program;
      renderedListingStep = null;
      renderedProgramByteCount = program.occupied.reduce((sum, byte) => sum + byte, 0);
      container.dataset.activeAddress = "";
    }
    $("#programSize").textContent = `${renderedProgramByteCount} bytes`;
    const activeAddress = lastStep ? lastStep.pc : cpu.PC;
    const active = container.querySelector(`tr[data-address="${activeAddress}"]`);
    container.querySelectorAll("tr").forEach((row) => row.classList.toggle("current", row === active));
    if (active && container.dataset.activeAddress !== String(activeAddress)) {
      const rowRect = active.getBoundingClientRect(), viewRect = container.getBoundingClientRect();
      if (rowRect.top < viewRect.top) container.scrollTop -= viewRect.top - rowRect.top;
      else if (rowRect.bottom > viewRect.bottom) container.scrollTop += rowRect.bottom - viewRect.bottom;
      container.dataset.activeAddress = String(activeAddress);
    }
    if (active && lastStep && renderedListingStep !== lastStep) pulse(active);
    renderedListingStep = lastStep;
  }
  function setFlow(flow, animate = true) {
    if (!flow) return;
    const panel = $("#flowPanel");
    panel.dataset.flow = flow.to === "memory" || flow.to === "stack" ? "write" : flow.from === "memory" || flow.from === "stack" ? "read" : "move";
    const route = flow.from === "cpu" ? ["cpu", flow.to]
      : flow.to === "cpu" ? [flow.from, "cpu"]
        : [flow.from, "cpu", flow.to];
    const names = { program: "Program memory", cpu: "Processor", registers: "Registers", memory: "Data memory", stack: "Stack", ports: "I/O ports" };
    const value = flow.value === undefined ? null : I8085.hex(flow.value, flow.width === 2 ? 4 : 2);
    const address = I8085.hex(flow.address == null ? lastStep.pc : flow.address, 4);
    const changedState = flow.changes && [
      ...flow.changes.registers,
      ...flow.changes.flags,
      ...(flow.changes.stackPointer ? ["SP"] : []),
    ];
    const action = changedState?.length ? `${lastStep.name}: updated ${changedState.join(", ")}`
      : flow.from === "memory" && flow.to === "memory" ? `Updated memory at ${address}H to ${value}H`
        : flow.from === "ports" ? `Read ${value}H from port ${I8085.hex(flow.address, 2)}H`
          : flow.to === "ports" ? `Wrote ${value}H to port ${I8085.hex(flow.address, 2)}H`
            : flow.from === "memory" && flow.to === "cpu" ? `${lastStep.name}: ALU result ${value}H from memory operand`
            : flow.from === "memory" && flow.to === "registers" ? t("dataRead", value, address)
              : flow.from === "registers" && flow.to === "memory" ? t("dataWrite", value, address)
                : flow.from === "stack" ? t("stackRead", value, address)
                  : flow.to === "stack" ? t("stackWrite", value, address)
                    : flow.from === "program" && flow.to === "memory" ? `Stored ${value}H at ${address}H`
                      : flow.from === "program" && flow.to === "cpu" && lastStep.name === "JMP" ? `Jumped to ${address}H`
                        : flow.from === "program" && value !== null ? t("programTransfer", value)
                          : flow.from === "registers" && flow.to === "cpu" ? `${lastStep.name}: ${value}H → CPU`
                            : value !== null ? t("registerTransfer", value)
                              : `Executed ${lastStep.name}`;
    $("#flowStep").textContent = action;
    $("#flowDescription").textContent = `${names[flow.from] || flow.from} → ${names[flow.to] || flow.to}`;
    const isPortTransfer = flow.from === "ports" || flow.to === "ports";
    $("#flowAddress").textContent = flow.address == null ? t("instructionAt", address)
      : `${isPortTransfer ? "Port" : t("address")} ${I8085.hex(flow.address, isPortTransfer ? 2 : 4)}H`;
    $("#flowData").textContent = flow.value === undefined ? "—" : `${I8085.hex(flow.value, flow.width === 2 ? 4 : 2)}H`;
    $("#programFlowValue").textContent = `PC: ${I8085.hex(lastStep.pc, 4)} · ${I8085.hex(lastStep.opcode)}H`;
    $("#cpuFlowValue").textContent = `${lastStep.name} · PC: ${I8085.hex(cpu.PC, 4)}`;
    $("#registerFlowValue").textContent = `A: ${I8085.hex(cpu.reg.A)} · HL: ${I8085.hex(cpu.pair("H"), 4)}`;
    const stackAddress = flow.address;
    $("#stackFlowValue").textContent = stackAddress !== undefined && (flow.from === "stack" || flow.to === "stack")
      ? `SP: ${I8085.hex(cpu.SP, 4)} · @${I8085.hex(stackAddress, 4)} ${I8085.hex(cpu.memory[stackAddress])}${flow.width === 2 ? ` ${I8085.hex(cpu.memory[(stackAddress + 1) & 0xffff])}` : ""}`
      : `SP: ${I8085.hex(cpu.SP, 4)}`;
    $("#memoryFlowValue").textContent = flow.address !== undefined && (flow.from === "memory" || flow.to === "memory")
      ? `@${I8085.hex(flow.address, 4)}: ${I8085.hex(cpu.memory[flow.address])}${flow.width === 2 ? ` ${I8085.hex(cpu.memory[(flow.address + 1) & 0xffff])}` : ""}`
      : "64 KB";
    if (isPortTransfer) $("#portsFlowValue").textContent = `Port ${I8085.hex(flow.address, 2)}: ${I8085.hex(cpu.ports[flow.address])}`;
    else $("#portsFlowValue").textContent = "256 ports";
    if (flow.address !== undefined && ["memory", "stack"].some((part) => flow.from === part || flow.to === part)) {
      const addr = flow.to === "stack" ? cpu.SP : flow.from === "stack" ? (cpu.SP - (flow.width || 1)) & 0xffff : flow.address;
      $("#memoryAddress").value = I8085.hex(addr & 0xfff0, 4);
    }
    if (!animate) return;
    const version = ++flowAnimationVersion;
    if (!panel.querySelector(".flow-map").getBoundingClientRect().width) {
      flowAnimationPromise = Promise.resolve();
      return;
    }
    updateFlowWires();
    flowAnimationPromise = animateFlowRoute(route, version);
  }
  function updateFlowWires() {
    const map = $(".flow-map");
    const svg = $(".flow-wires");
    const mapRect = map.getBoundingClientRect();
    if (!mapRect.width || !mapRect.height) return;
    const scaleX = 900 / mapRect.width, scaleY = 360 / mapRect.height;
    for (const wire of svg.querySelectorAll("path[data-wire]")) {
      const [from, to] = wire.dataset.wire.split("-");
      const source = map.querySelector(`[data-flow-node="${from}"]`)?.getBoundingClientRect();
      const target = map.querySelector(`[data-flow-node="${to}"]`)?.getBoundingClientRect();
      if (!source || !target) continue;
      const center = (rect) => ({
        x: (rect.left + rect.width / 2 - mapRect.left) * scaleX,
        y: (rect.top + rect.height / 2 - mapRect.top) * scaleY,
      });
      const a = center(source), b = center(target);
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      let start, end, direction;
      if (horizontal) {
        direction = b.x >= a.x ? 1 : -1;
        start = { x: ((direction > 0 ? source.right : source.left) - mapRect.left) * scaleX, y: a.y };
        end = { x: ((direction > 0 ? target.left : target.right) - mapRect.left) * scaleX, y: b.y };
      } else {
        direction = b.y >= a.y ? 1 : -1;
        start = { x: a.x, y: ((direction > 0 ? source.bottom : source.top) - mapRect.top) * scaleY };
        end = { x: b.x, y: ((direction > 0 ? target.top : target.bottom) - mapRect.top) * scaleY };
      }
      const distance = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
      const bend = Math.max(34, distance * .42);
      const c1 = horizontal ? { x: start.x + direction * bend, y: start.y } : { x: start.x, y: start.y + direction * bend };
      const c2 = horizontal ? { x: end.x - direction * bend, y: end.y } : { x: end.x, y: end.y - direction * bend };
      wire.setAttribute("d", `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`);
    }
  }
  function animateFlowRoute(route, version) {
    const panel = $("#flowPanel");
    const map = panel.querySelector(".flow-map");
    const packet = $("#dataPacket");
    flowAnimating = true;
    map.classList.add("animating");
    panel.querySelectorAll(".flow-node").forEach((node) => node.classList.remove("active", "source", "target"));
    panel.querySelectorAll(".flow-wires path[data-wire]").forEach((wire) => wire.classList.remove("active"));

    const animateSegment = (index) => {
      if (version !== flowAnimationVersion || index >= route.length - 1) return Promise.resolve();
      const sourceId = route[index], targetId = route[index + 1];
      const wire = panel.querySelector(`[data-wire="${sourceId}-${targetId}"]`);
      if (!wire) return Promise.resolve();
      const sourceNode = panel.querySelector(`[data-flow-node="${sourceId}"]`);
      const targetNode = panel.querySelector(`[data-flow-node="${targetId}"]`);
      panel.querySelectorAll(".flow-node").forEach((node) => node.classList.remove("active", "source", "target"));
      panel.querySelectorAll(".flow-wires path[data-wire]").forEach((path) => path.classList.remove("active"));
      sourceNode?.classList.add("active", "source");
      targetNode?.classList.add("active", "target");
      wire.classList.add("active");

      const start = wire.getPointAtLength(0);
      packet.setAttribute("cx", start.x);
      packet.setAttribute("cy", start.y);
      return new Promise((resolve) => {
        const startedAt = performance.now();
        const duration = timer ? Math.max(120, 440 / Math.sqrt(Number($("#speed").value))) : 620;
        const frame = (now) => {
          if (version !== flowAnimationVersion) { resolve(); return; }
          const progress = Math.min((now - startedAt) / duration, 1);
          const eased = 1 - (1 - progress) ** 3;
          const point = wire.getPointAtLength(wire.getTotalLength() * eased);
          packet.setAttribute("cx", point.x);
          packet.setAttribute("cy", point.y);
          if (progress < 1) requestAnimationFrame(frame);
          else {
            sourceNode?.classList.remove("active", "source");
            targetNode?.classList.remove("source");
            resolve();
          }
        };
        requestAnimationFrame(frame);
      }).then(() => animateSegment(index + 1));
    };

    return animateSegment(0).then(() => {
      if (version !== flowAnimationVersion) return;
      flowAnimating = false;
      map.classList.remove("animating");
      if (program && !timer && !cpu.halted) $("#stepBtn").disabled = false;
    });
  }
  function clearFlow() {
    flowAnimationVersion++;
    flowAnimating = false;
    const panel = $("#flowPanel");
    panel.querySelector(".flow-map").classList.remove("animating");
    delete panel.dataset.flow;
    panel.querySelectorAll(".flow-node").forEach((node) => node.classList.remove("active", "source", "target"));
    panel.querySelectorAll(".flow-wires path[data-wire]").forEach((wire) => wire.classList.remove("active"));
    $("#flowStep").textContent = t("waitingExecution");
    $("#flowDescription").textContent = t("flowDescription");
    $("#flowAddress").textContent = t("flowPrompt");
    $("#flowData").textContent = "—";
    $("#programFlowValue").textContent = "Instructions & data";
    $("#cpuFlowValue").textContent = "Control unit · ALU";
    $("#memoryFlowValue").textContent = "64 KB";
    $("#registerFlowValue").textContent = `A: ${I8085.hex(cpu.reg.A)} · HL: ${I8085.hex(cpu.pair("H"), 4)}`;
    $("#stackFlowValue").textContent = "Grows toward lower addresses";
    $("#portsFlowValue").textContent = "256 ports";
  }
  function pulse(element) {
    if (!element) return;
    element.classList.remove("changed");
    void element.offsetWidth;
    element.classList.add("changed");
    setTimeout(() => element.classList.remove("changed"), 720);
  }
  function animateChanges(before) {
    let registersChanged = false, flagsChanged = false;
    for (const name of ["A", "B", "C", "D", "E", "H", "L"]) {
      if (before.reg[name] !== cpu.reg[name]) { registersChanged = true; pulse($(`#reg${name}`)); }
    }
    if (before.SP !== cpu.SP) { registersChanged = true; pulse($("#regSP")); }
    if (before.PC !== cpu.PC) pulse($("#regPC"));
    for (const name of Object.keys(cpu.flags)) {
      if (before.flags[name] !== cpu.flags[name]) { flagsChanged = true; pulse(document.querySelector(`[data-flag="${name}"]`)); }
    }
    if (registersChanged) pulse(document.querySelector('[data-flow-node="registers"]'));
    if (flagsChanged) pulse($(".flags"));
    if (before.PC !== cpu.PC) pulse(document.querySelector('[data-flow-node="cpu"]'));
    pulse($("#instructionCount"));
    if (lastStep.flow?.address !== undefined) {
      const flow = lastStep.flow;
      if (flow.from === "memory" || flow.to === "memory" || flow.from === "stack" || flow.to === "stack") {
        pulse(document.querySelector(`[data-flow-node="${flow.from === "stack" || flow.to === "stack" ? "stack" : "memory"}"]`));
        pulse($("#flowData"));
        setTimeout(() => {
          const bytes = $("#memoryView").querySelectorAll(".memory-byte");
          const base = parseInt($("#memoryAddress").value, 16);
          const index = (flow.address - base + 0x10000) & 0xffff;
          if (index < bytes.length) pulse(bytes[index]);
        }, 0);
      }
    }
  }
  function render() {
    for (const key of ["A", "B", "C", "D", "E", "H", "L"]) $(`#reg${key}`).textContent = I8085.hex(cpu.reg[key]);
    $("#regF").textContent = I8085.hex(flagsByte());
    $("#regPC").textContent = I8085.hex(cpu.PC, 4);
    $("#regSP").textContent = I8085.hex(cpu.SP, 4);
    $("#instructionCount").textContent = cpu.instructionCount.toLocaleString("en-US");
    const execution = $("#editorExecution");
    execution.textContent = lastStep
      ? `PC ${I8085.hex(lastStep.pc, 4)} · ${lastStep.name}`
      : program ? `Entry ${I8085.hex(program.entry, 4)}` : "Not executing";
    execution.classList.toggle("active", !!lastStep);
    updateLineNumbers();
    for (const [name, value] of Object.entries(cpu.flags)) document.querySelector(`[data-flag="${name}"]`).classList.toggle("active", value);
    renderMemory();
    renderStack();
    renderListing();
    $("#stepBtn").disabled = !program || cpu.halted || !!timer || flowAnimating;
    $("#runBtn").disabled = !program;
    $("#resetBtn").disabled = !program;
  }
  function assemble() {
    pause();
    try {
      program = I8085.assemble(source.value);
      cpu.load(program);
      lastStep = null;
      clearFlow();
      setStateKey("ready");
      const count = program.occupied.reduce((sum, byte) => sum + byte, 0);
      setStatus(() => t("assembled", count, I8085.hex(program.entry, 4)), "success");
      render();
    } catch (error) {
      program = null;
      render();
      setStatus(translateError(error), "error");
      setStateKey("error", "halted");
    }
  }
  function step(shouldRender = true) {
    if (!program || cpu.halted) return;
    try {
      const before = { reg: { ...cpu.reg }, flags: { ...cpu.flags }, PC: cpu.PC, SP: cpu.SP };
      lastStep = cpu.step();
      setFlow(lastStep.flow);
      animateChanges(before);
      if (lastStep.halted) {
        pause();
        setStateKey("halted", "halted");
        setStatus(() => t("haltedAt", I8085.hex(lastStep.pc, 4), cpu.instructionCount), "success");
      } else {
        setStateKey(timer ? "running" : "ready", timer ? "running" : undefined);
        setStatus(() => t("executedAt", lastStep.name, I8085.hex(lastStep.pc, 4), I8085.hex(cpu.PC, 4)));
      }
      if (shouldRender) render();
    } catch (error) {
      pause();
      setStateKey("error", "halted");
      setStatus(translateError(error), "error");
      if (shouldRender) render();
    }
  }
  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    if (program && !cpu.halted && $("#cpuState").dataset.stateKey === "running") setStateKey("stopped");
    $("#runBtn").innerHTML = `<span class="button-icon">▶</span><span data-i18n="run">${t("run")}</span><kbd>F5</kbd>`;
    render();
  }
  function run() {
    if (!program || cpu.halted) return;
    if (timer) { pause(); return; }
    setStateKey("running", "running");
    $("#runBtn").innerHTML = `<span class="button-icon">Ⅱ</span><span data-i18n="pause">${t("pause")}</span><kbd>F5</kbd>`;
    timer = setInterval(async () => {
      if (runTickBusy) return;
      runTickBusy = true;
      try {
        if (flowAnimating) await flowAnimationPromise;
        const count = Number($("#speed").value);
        for (let i = 0; i < count && !cpu.halted && timer; i++) {
          step(true);
          await flowAnimationPromise;
        }
        if (!cpu.halted && timer) setStateKey("running", "running");
      } finally {
        runTickBusy = false;
      }
    }, 420);
  }
  $("#assembleBtn").addEventListener("click", assemble);
  $("#stepBtn").addEventListener("click", () => step());
  $("#runBtn").addEventListener("click", run);
  $("#resetBtn").addEventListener("click", () => {
    pause();
    if (!program) return;
    cpu.load(program);
    lastStep = null;
    clearFlow();
    setStateKey("ready");
    setStatus(t("resetDone"));
    render();
  });
  $("#sampleSelect").addEventListener("change", (event) => {
    pause();
    source.value = samples[event.target.value].en;
    program = null;
    lastStep = null;
    cpu.reset();
    clearFlow();
    setStateKey("stopped");
    setStatus(t("sampleLoaded"));
    updateLineNumbers();
    render();
  });
  $("#speed").addEventListener("input", (event) => { $("#speedValue").textContent = event.target.value; });
  $("#memoryAddress").addEventListener("change", renderMemory);
  $("#memoryAddress").addEventListener("keydown", (event) => { if (event.key === "Enter") renderMemory(); });
  source.addEventListener("input", updateLineNumbers);
  source.addEventListener("scroll", () => { $("#lineNumbers").scrollTop = source.scrollTop; });
  source.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = source.selectionStart;
      source.setRangeText("    ", start, source.selectionEnd, "end");
      updateLineNumbers();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); assemble(); }
    else if (event.key === "F5") { event.preventDefault(); run(); }
    else if (event.key === "F6") { event.preventDefault(); step(); }
    else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "r") { event.preventDefault(); $("#resetBtn").click(); }
  });
  document.querySelectorAll(".mobile-tabs [data-mobile-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.mobileView;
      document.body.dataset.mobileView = view;
      document.querySelectorAll(".mobile-tabs [data-mobile-view]").forEach((item) => {
        item.setAttribute("aria-selected", String(item === tab));
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (view === "flow") requestAnimationFrame(() => {
        updateFlowWires();
        if (lastStep) setFlow(lastStep.flow);
      });
    });
  });
  const installButton = $("#installAppBtn");
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
  });
  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js")
      .catch((error) => console.error("Could not register the offline app worker:", error));
  }
  window.desktopBridge?.onMenuAction((action) => {
    if (action === "assemble") assemble();
    else if (action === "step") step();
    else if (action === "run") run();
    else if (action === "reset") $("#resetBtn").click();
    else if (action === "about") setStatus(t("about"));
  });
  updateFlowWires();
  if ("ResizeObserver" in window) {
    const flowObserver = new ResizeObserver(updateFlowWires);
    flowObserver.observe($(".flow-map"));
    document.querySelectorAll(".flow-node").forEach((node) => flowObserver.observe(node));
  } else window.addEventListener("resize", updateFlowWires);
  applyLanguage();
  setStateKey("stopped");
  setStatus(t("initialStatus"));
  render();
})();
