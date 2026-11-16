# WARITH 8085

An Intel 8085 learning lab that runs in the browser, including a phone layout and offline use after the first visit.

## Open the lab

Open https://warithh.github.io/warith-8085/ on a phone or a computer. On Android, use Chrome and choose **Install app** or **Add to Home screen**. On iPhone, use Safari and choose **Share → Add to Home Screen**. The first visit needs a network connection.

Choose an example or write a program, then press **Assemble**. Use **Step** for one instruction, **Run** for continuous execution, and **Reset** to return to the start. The phone tabs are Code, Flow, Registers, and Memory. Each tab has **Back**: it returns to Code, and from Code it returns to the previous page.

**Kit** opens the MTK-85 trainer. **Calculator** adds, subtracts, multiplies, and divides one byte and shows the same flags as the processor. Both pages have **Back** to the lab.

## Files

- `index.html` — the lab page.
- `kit.html` — the trainer kit.
- `calculator.html` — the one-byte calculator.
- `styles.css`, `kit.css`, and `calculator.css` — page layout.
- `app.js`, `core.js`, `kit.js`, `kit-monitor.js`, and `calculator.js` — the lab, the 8085 core, and the two tools.
- `manifest.webmanifest` and `service-worker.js` — installation and offline use.
- `assets/` — icons, the Atkinson Hyperlegible font, and the MIT-licensed Tabler CSS in `assets/vendor/TABLER-LICENSE.txt`.
