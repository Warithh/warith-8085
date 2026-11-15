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
    if (name === "S") return on ? "البت 7 في الناتج يساوي 1." : "البت 7 في الناتج يساوي 0.";
    if (name === "Z") return on ? "الناتج داخل البايت هو 00H." : "الناتج ليس صفراً.";
    if (name === "P") {
      let ones = 0, bits = value.result & 255;
      while (bits) { ones++; bits &= bits - 1; }
      return `عدد البتات ذات القيمة 1 هو ${ones}، وهو ${on ? "زوجي" : "فردي"}.`;
    }
    if (name === "AC") {
      if (operation === "add") return on ? `النصف السفلي ${I8085.hex(a & 15)}+${I8085.hex(b & 15)} يتجاوز F.` : `النصف السفلي ${I8085.hex(a & 15)}+${I8085.hex(b & 15)} يبقى ضمن 4 بت.`;
      if (operation === "sub") return on ? `النصف السفلي ${I8085.hex(a & 15)} أصغر من ${I8085.hex(b & 15)}، فهناك استعارة.` : `النصف السفلي لا يحتاج استعارة.`;
      return "هذه العملية لا تكتب المحمول المساعد.";
    }
    if (operation === "add") return on ? `المجموع ${a + b} أكبر من 255.` : `المجموع ${a + b} يبقى داخل البايت.`;
    if (operation === "sub") return on ? `${I8085.hex(a)} أصغر من ${I8085.hex(b)}، فهناك استعارة.` : "العدد الأول يكفي بلا استعارة.";
    if (operation === "mul") return on ? `الضرب ${a * b} لا يسعه بايت واحد.` : "الضرب يبقى داخل بايت واحد.";
    return on ? `الباقي ${I8085.hex(value.remainder)}.` : "القسمة بلا باقٍ.";
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
      showEmpty("اكتب العددين. لكل عدد من رقم إلى رقمين، مثل 2A أو FF.");
      return;
    }
    const value = I8085.calculate8(operation, a, b);
    if (value.error) {
      showEmpty("لا يمكن القسمة على صفر.");
      return;
    }
    $("#hexWait").hidden = true;
    $("#hexBits").hidden = false;
    const shown = operation === "mul" ? value.full : value.result;
    const width = operation === "mul" ? 4 : operation === "add" && value.full > 255 ? 3 : 2;
    $("#hexResult").textContent = I8085.hex(shown, width);
    $("#hexResultDec").textContent = operation === "div"
      ? `الباقي ${value.remainder}`
      : String(operation === "sub" ? value.full : shown);
    $("#hexFull").innerHTML = operation === "div"
      ? `خارج القسمة <bdi dir="ltr">${I8085.hex(value.result)}H</bdi> · الباقي <bdi dir="ltr">${I8085.hex(value.remainder)}H</bdi>`
      : operation === "sub"
        ? `فرق البايت <bdi dir="ltr">${I8085.hex(value.result)}H</bdi> · الفرق العددي <bdi dir="ltr">${value.full}</bdi>`
        : `الناتج الكامل <bdi dir="ltr">${I8085.hex(operation === "add" ? value.full : shown, width)}H</bdi>`;
    $("#hexBits").innerHTML = `
      <div class="bit-lane"><span>A</span>${bits(a)}</div>
      <div class="bit-lane"><span>B</span>${bits(b)}</div>
      <div class="bit-lane sum"><span>=</span>${bits(value.result)}</div>
      <p class="bit-note">بتات الناتج داخل البايت. العلم المضيء قيمته 1.</p>`;
    const titles = { S: "الإشارة", Z: "الصفر", AC: "محمول مساعد", P: "الازدواج", CY: "المحمول" };
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
})();
