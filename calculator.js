(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const first = $("#hexA");
  const second = $("#hexB");
  const marks = { add: "+", sub: "−", mul: "×", div: "÷" };
  let operation = "add";

  function clean(input) {
    const next = input.value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 2);
    if (input.value !== next) input.value = next;
    return next;
  }
  function read(text) {
    return /^[0-9A-F]{1,2}$/.test(text) ? parseInt(text, 16) : null;
  }
  function bits(value) {
    let html = "";
    for (let bit = 7; bit >= 0; bit--) {
      if (bit === 3) html += "<i></i>";
      const on = (value >> bit) & 1;
      html += `<b class="${on ? "on" : ""}">${on}</b>`;
    }
    return `<div class="bit-cells">${html}</div>`;
  }
  function explain(name, on, a, b, value) {
    if (name === "S") return on ? "Bit 7 of the result is 1." : "Bit 7 of the result is 0.";
    if (name === "Z") return on ? "The byte result is 00H." : "The result is not zero.";
    if (name === "P") {
      let ones = 0, bits = value.result & 255;
      while (bits) { ones++; bits &= bits - 1; }
      return `${ones} bits are 1, an ${on ? "even" : "odd"} count.`;
    }
    if (name === "AC") {
      if (operation === "add") return on ? `Low nibbles ${I8085.hex(a & 15)}+${I8085.hex(b & 15)} pass F.` : `Low nibbles ${I8085.hex(a & 15)}+${I8085.hex(b & 15)} stay within 4 bits.`;
      if (operation === "sub") return on ? `Low nibble ${I8085.hex(a & 15)} is smaller than ${I8085.hex(b & 15)}, so there is a borrow.` : "The low nibble needs no borrow.";
      return "This operation does not write the auxiliary carry.";
    }
    if (operation === "add") return on ? `The sum ${a + b} is greater than 255.` : `The sum ${a + b} fits in one byte.`;
    if (operation === "sub") return on ? `${I8085.hex(a)} is smaller than ${I8085.hex(b)}, so there is a borrow.` : "The first byte needs no borrow.";
    if (operation === "mul") return on ? `The product ${a * b} does not fit in one byte.` : "The product fits in one byte.";
    return on ? `Remainder ${I8085.hex(value.remainder)}.` : "The division has no remainder.";
  }
  function showEmpty(message) {
    $("#hexResult").textContent = "—";
    $("#hexResultDec").textContent = message;
    $("#hexFull").textContent = "";
    $("#hexWait").hidden = false;
    $("#hexWait").textContent = message;
    $("#hexBits").hidden = true;
    $("#hexFlags").innerHTML = "";
  }
  function render() {
    const a = read(clean(first));
    const b = read(clean(second));
    $("#opMark").textContent = marks[operation];
    $("#hexADec").textContent = a === null ? "—" : String(a);
    $("#hexBDec").textContent = b === null ? "—" : String(b);
    if (a === null || b === null) {
      showEmpty("Type both bytes. Each is one or two hex digits, such as 2A or FF.");
      return;
    }
    const value = I8085.calculate8(operation, a, b);
    if (value.error) {
      showEmpty("Cannot divide by zero.");
      return;
    }
    $("#hexWait").hidden = true;
    $("#hexBits").hidden = false;
    const shown = operation === "mul" ? value.full : value.result;
    const width = operation === "mul" ? 4 : operation === "add" && value.full > 255 ? 3 : 2;
    $("#hexResult").textContent = I8085.hex(shown, width);
    $("#hexResultDec").textContent = operation === "div"
      ? `Remainder ${value.remainder}`
      : String(operation === "sub" ? value.full : shown);
    $("#hexFull").innerHTML = operation === "div"
      ? `Quotient ${I8085.hex(value.result)}H · remainder ${I8085.hex(value.remainder)}H`
      : operation === "sub"
        ? `Byte difference ${I8085.hex(value.result)}H · numeric difference ${value.full}`
        : `Full result ${I8085.hex(operation === "add" ? value.full : shown, width)}H`;
    $("#hexBits").innerHTML = `
      <div class="bit-lane"><span>A</span>${bits(a)}</div>
      <div class="bit-lane"><span>B</span>${bits(b)}</div>
      <div class="bit-lane sum"><span>=</span>${bits(value.result)}</div>
      <p class="bit-note">Bits of the result byte. A lit flag has value 1.</p>`;
    const titles = { S: "Sign", Z: "Zero", AC: "Aux carry", P: "Parity", CY: "Carry" };
    $("#hexFlags").innerHTML = ["S", "Z", "AC", "P", "CY"].map((name) => {
      const on = value.flags[name];
      return `<article class="flag${on ? " on" : ""}"><b>${name}</b><i>${on ? "1" : "0"}</i><small>${titles[name]}. ${explain(name, on, a, b, value)}</small></article>`;
    }).join("");
  }

  document.querySelectorAll(".ops button").forEach((button) => {
    button.addEventListener("click", () => {
      operation = button.dataset.op;
      document.querySelectorAll(".ops button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      render();
    });
  });
  [first, second].forEach((input) => input.addEventListener("input", render));
  render();
  first.focus();
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
