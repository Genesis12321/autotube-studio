/** Páginas públicas que TikTok y Google exigen al registrar la aplicación. */
const page = (title: string, body: string): string => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · AutoTube Studio</title>
<style>body{margin:0 auto;padding:2rem 1.25rem;max-width:44rem;font:16px/1.6 system-ui,sans-serif;color:#111}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}</style>
</head><body><h1>${title}</h1>${body}
<p><a href="/">Volver a AutoTube Studio</a></p></body></html>`

export const terms = (): string =>
  page(
    'Condiciones del servicio',
    `<p>AutoTube Studio es una herramienta personal que genera vídeos automáticamente y, si su propietario lo autoriza, los publica en sus propias cuentas de YouTube y TikTok.</p>
<h2>Uso</h2><p>El acceso está restringido al propietario mediante contraseña. No se ofrece el servicio a terceros ni se permite su uso comercial por otras personas.</p>
<h2>Contenido</h2><p>El propietario es el único responsable de los vídeos generados y publicados, y de cumplir las normas de las plataformas donde se publiquen.</p>
<h2>Garantías</h2><p>El servicio se ofrece «tal cual», sin garantía de disponibilidad ni de resultados, y puede interrumpirse o retirarse en cualquier momento.</p>
<h2>Contacto</h2><p>cristian.duro.fernandez@gmail.com</p>`,
  )

export const privacy = (): string =>
  page(
    'Política de privacidad',
    `<p>AutoTube Studio es una aplicación de uso personal y no recoge datos de visitantes.</p>
<h2>Datos que se tratan</h2><p>Únicamente los permisos (tokens) que el propietario concede a sus cuentas de YouTube y TikTok para poder subir sus vídeos, y los vídeos generados por él.</p>
<h2>Uso</h2><p>Esos permisos se usan solo para publicar vídeos en las cuentas del propio propietario. No se comparten, venden ni ceden a terceros.</p>
<h2>Conservación</h2><p>Los vídeos se borran automáticamente cada día. Los permisos se conservan mientras la cuenta esté conectada y se eliminan al desconectarla desde la aplicación o al revocarlos en YouTube o TikTok.</p>
<h2>Contacto</h2><p>cristian.duro.fernandez@gmail.com</p>`,
  )
