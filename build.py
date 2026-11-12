#!/usr/bin/env python3
"""Genera la carta completa y el catálogo del pedido dentro de site/index.html desde carta.json.

Uso: python3 build.py   (vuelve a escribir solo lo que está entre los marcadores)
"""
import html, json, pathlib, re, urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
DATA = json.loads((HERE / "carta.json").read_text(encoding="utf8"))
INDEX = HERE / "site" / "index.html"
WA = "51904558521"


def money(p):
    if p is None:
        return "Consultar"
    return f"S/{p:.2f}" if p % 1 else f"S/{int(p)}"


def wa_link(item):
    price = "" if item["price"] is None else f" ({money(item['price'])})"
    text = f"Hola D’Chicken, quiero pedir: {item['name']}{price}"
    return f"https://wa.me/{WA}?text=" + urllib.parse.quote(text, safe="")


PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'


def dish(item):
    e = html.escape
    desc = f'<span class="dish-desc">{e(item["desc"])}</span>' if item["desc"] else ""
    ask = " ask" if item["price"] is None else ""
    return (
        f'<li class="dish" data-item="{item["id"]}">'
        f'<div class="dish-info"><span class="dish-name">{e(item["name"])}</span>{desc}</div>'
        f'<span class="dish-price{ask}">{money(item["price"])}</span>'
        f'<div class="dish-ctl"><a class="add" href="{e(wa_link(item))}" data-add="{item["id"]}" '
        f'aria-label="Agregar {e(item["name"])} al pedido">{PLUS}</a></div></li>'
    )


def photo(cat):
    k, alt = cat["photo"], html.escape(cat["alt"])
    return (
        f'<figure class="cat-photo"><picture><source srcset="img/cat-{k}.webp" type="image/webp">'
        f'<img src="img/cat-{k}.jpg" alt="{alt} (imagen referencial)" loading="lazy" decoding="async"></picture></figure>'
    )


def carta():
    e = html.escape
    chips = ['<a href="#ofertas">Ofertas</a>', '<a href="#alitas">Alitas</a>'] + [
        f'<a href="#{c["id"]}">{e(c["chip"])}</a>' for c in DATA["categorias"]
    ]
    out = [
        '<section class="carta" id="carta" aria-labelledby="carta-title">',
        '  <div class="wrap carta-head reveal">',
        '    <p class="eyebrow">Pollería · Chifa · Parrillas</p>',
        '    <h2 id="carta-title" class="display h2">La carta</h2>',
        '    <p class="body-lg">Toca <b>+</b> en lo que quieras. Al final envías todo en un solo WhatsApp, con el total.</p>',
        "  </div>",
        '  <nav class="chips" aria-label="Categorías de la carta"><div class="chips-in">' + "".join(chips) + "</div></nav>",
        '  <div class="wrap cats">',
    ]
    for c in DATA["categorias"]:
        out.append(f'    <section class="cat" id="{c["id"]}" aria-labelledby="{c["id"]}-t">')
        out.append(
            f'      <header class="cat-head reveal">{photo(c)}<div class="cat-titles">'
            f'<p class="eyebrow">{e(c["kicker"])}</p><h3 id="{c["id"]}-t" class="display cat-title">{e(c["title"])}</h3></div></header>'
        )
        groups = c.get("groups") or [{"name": None, "items": c["items"]}]
        out.append('      <div class="cat-body">')
        for g in groups:
            if g["name"]:
                out.append(f'        <h4 class="group-name">{e(g["name"])}</h4>')
            out.append('        <ul class="dishes" role="list">' + "".join(dish(i) for i in g["items"]) + "</ul>")
        out.append("      </div>")
        out.append("    </section>")
    out.append('    <p class="fine carta-note">Las fotos de la carta son referenciales. Precios en soles; el delivery (S/4 a S/8 según tu zona) se confirma por WhatsApp.</p>')
    out.append("  </div>")
    out.append("</section>")
    return "\n".join(out)


def catalog():
    items = list(DATA["destacados"])
    for c in DATA["categorias"]:
        for g in c.get("groups") or [{"items": c["items"]}]:
            items += g["items"]
    ids = [i["id"] for i in items]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"IDs repetidos: {dup}")
    cat = {i["id"]: {"n": i["name"], "p": i["price"]} for i in items}
    return '<script type="application/json" id="catalogo">' + json.dumps(cat, ensure_ascii=False) + "</script>", len(cat)


def put(src, name, block):
    pat = re.compile(rf"(<!-- {name}:START -->).*?(<!-- {name}:END -->)", re.S)
    if not pat.search(src):
        raise SystemExit(f"Falta el marcador {name}")
    return pat.sub(lambda m: m.group(1) + "\n" + block + "\n" + m.group(2), src)


src = INDEX.read_text(encoding="utf8")
src = put(src, "CARTA", carta())
cat_html, n = catalog()
src = put(src, "CATALOGO", cat_html)
# Los botones destacados (data-add) deben existir en el catálogo
cat_ids = set(json.loads(cat_html.split(">", 1)[1].rsplit("<", 1)[0]))
missing = sorted(set(re.findall(r'data-add="([^"]+)"', src)) - cat_ids)
if missing:
    raise SystemExit(f"data-add sin producto en el catálogo: {missing}")
INDEX.write_text(src, encoding="utf8")
print(f"carta: {len(DATA['categorias'])} categorías · catálogo: {n} productos")
