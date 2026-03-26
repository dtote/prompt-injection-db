# Prompt Injection DB

Base de datos de prompt injections. Los datos se persisten en el archivo **`data.json`** en el servidor.

## Cómo ejecutar

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Arrancar el servidor:
   ```bash
   npm start
   ```

3. Abrir en el navegador: **http://localhost:3000**

El servidor sirve la página y lee/escribe `data.json` en la raíz del proyecto. Cada vez que añades, editas o eliminas un ataque, se guarda en ese archivo.

### Desarrollo con live reload

Para que la página se recargue sola al cambiar HTML, CSS o JS:

```bash
npm run dev
```

Abre **http://localhost:3000** (la misma URL). Al guardar cambios en `index.html`, `styles.css` o `app.js`, el navegador se actualizará solo.
