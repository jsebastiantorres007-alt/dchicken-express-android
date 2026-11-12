# D’Chicken Express · web para clientes

Web pública de la pollería: portada, ofertas, alitas, carta completa con carrito y pedido por WhatsApp (904 558 521).

- `site/`: la web que se publica (HTML, CSS, JS, fuentes e imágenes optimizadas).
- `carta.json`: **la carta**. Para cambiar un precio o agregar un plato, edita este archivo.
- `build.py`: escribe la carta y el catálogo del carrito dentro de `site/index.html` (Vercel lo ejecuta al publicar).

Sin librerías ni dependencias. Para verla en tu computadora: `python3 build.py && cd site && python3 -m http.server`.

## Publicación

- Producción: https://dchicken-express.vercel.app (proyecto de Vercel «dchicken-express»).
- El código vive en la rama `web` del repositorio `dchicken-express-android`.
- Vercel no está conectado a GitHub: para publicar un cambio, se sube a la rama `web` y se crea un despliegue
  con `deploy/build.sh` y `vercel.json` (Vercel descarga la rama, ejecuta `build.py` y publica `site/`).
