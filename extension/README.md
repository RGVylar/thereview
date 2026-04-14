# The Review Sync — extensión (prototipo)

Instrucciones rápidas para probar la extensión en Brave / Chrome (desarrollo local):

1. Abre `brave://extensions` (o `chrome://extensions` en Chrome).
2. Activa *Developer mode* (esquina superior derecha).
3. Pulsa *Load unpacked* y selecciona la carpeta `extension` del repositorio.
4. Abre la web de desarrollo (`npm run dev`) y carga una página con vídeo (Twitter/TikTok).
5. La web emitirá un ping; la extensión responderá para que la aplicación detecte que está instalada.

Nota: esto es un prototipo mínimo que únicamente responde al ping `THEREVIEW_EXTENSION_PING`.
