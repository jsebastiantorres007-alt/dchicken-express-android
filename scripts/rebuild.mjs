// Vercel: toma la v16 recién construida en base/dist, la formatea igual que app/ y aplica patches/*.patch.
// Si algún archivo no coincide byte a byte con app/ (SHA-1), el build falla y producción no cambia.
// (Sin barras invertidas: el archivo se sube por API sin escapes.)
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const NL = String.fromCharCode(10);
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const prettier = process.env.PRETTIER || "npx -y prettier@3.8.1";
execSync(prettier + " --print-width 120 --write base/dist/app.js base/dist/cloud.js", { stdio: "inherit" });
for (const name of ["app.js", "cloud.js", "app.css"]) {
  const t = readFileSync(`patches/${name}.patch`, "utf8").split(NL);
  const [, base, want] = t[0].split(" ");
  const ops = [];
  for (let i = 1; i < t.length; ) {
    if (!t[i].startsWith("@@ ")) {
      i++;
      continue;
    }
    const [, start, del, n] = t[i].split(" ").map(Number);
    ops.push([start, del, t.slice(i + 1, i + 1 + n)]);
    i += 1 + n;
  }
  const src = readFileSync(`base/dist/${name}`, "utf8");
  const lines = src.split(NL);
  let out;
  if (name === "app.css") {
    // El CSS de la v16 depende de cómo Vercel compila la fuente (woff2); los estilos nuevos solo se agregan al final.
    const add = ops.flatMap(([, , a]) => a);
    lines.splice(lines.length - 1, 0, ...add);
    out = lines.join(NL);
    if (!out.endsWith(add.join(NL) + NL)) throw new Error("rebuild: no se pudo agregar el CSS nuevo");
  } else {
    if (sha1(src) !== base) throw new Error(`rebuild: la base de ${name} no coincide (${sha1(src)} ≠ ${base})`);
    for (const [start, del, add] of ops.sort((x, y) => y[0] - x[0])) lines.splice(start, del, ...add);
    out = lines.join(NL);
    if (sha1(out) !== want) throw new Error(`rebuild: ${name} no coincide tras aplicar cambios`);
  }
  writeFileSync(`base/dist/${name}`, out);
  console.log(`rebuild: ${name} OK ${name === "app.css" ? "(estilos v17 agregados)" : want}`);
}
// Versión 17 en la página, el service worker y el manifiesto.
const SMALL = {
  "index.html": [["?v=16", "?v=17.1"]],
  "sw.js": [["?v=16", "?v=17.1"], ["service worker v16", "service worker v17.1"], ["dchicken-v16.0", "dchicken-v17.1"]],
  "manifest.webmanifest": [["?app=v16", "?app=v17"]],
};
for (const [f, pairs] of Object.entries(SMALL)) {
  let s = readFileSync(`base/dist/${f}`, "utf8");
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`rebuild: ${f} no contiene ${a}`);
    s = s.split(a).join(b);
  }
  if (s.includes("v=16") || s.includes("v16")) throw new Error(`rebuild: ${f} conserva referencias a la v16`);
  writeFileSync(`base/dist/${f}`, s);
  console.log(`rebuild: ${f} OK`);
}
rmSync("dist", { recursive: true, force: true });
cpSync("base/dist", "dist", { recursive: true });
console.log("rebuild: dist listo");
