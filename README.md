# RadioConecta TIC (prototipo)

Propuesta de aplicación para acompañar a radios comunitarias en Colombia: perfil y equipos, documentos, alertas, reportes, mapa de Girón con cobertura, análisis técnico (sección 07), panel institucional y asistente educativo con IA.

> No es un sitio oficial de MinTIC ni de la ANE y no reemplaza ningún trámite. Los cálculos son estimaciones de apoyo.

## Roles

| Rol | Qué ve |
|---|---|
| **Administrador** | Resumen institucional, mapa (puede agregar, editar, quitar e importar emisoras), análisis técnico, **Panel de seguimiento** con datos reales de los solicitantes, **Solicitudes y usuarios** (detalle por solicitante, eliminar cuentas). |
| **Solicitante** | Su perfil y equipos, documentos, alertas, reportes, ruta de constitución (01–05), mapa (solo lectura) y análisis técnico. |

Cuentas iniciales (se crean al arrancar el servidor):

- Administrador: usuario `admin` (o `ADMIN_USER`), clave en `ADMIN_PASSWORD`.
- Solicitante de prueba: usuario `solicitante` (o `SOLICITANTE_USER`), clave en `SOLICITANTE_PASSWORD`.
- Cualquier persona puede crear su propia cuenta de **solicitante** en "Crear cuenta" (mínimo 8 caracteres). Nadie puede crearse como administrador.

Las claves **no están en el código**: en Render las genera la plataforma y las ves en *Environment*.

## Publicar en GitHub y Render

1. **GitHub.** Crea un repositorio nuevo (por ejemplo `radioconecta-tic`) y sube todo el contenido de esta carpeta (`server.js`, `package.json`, `render.yaml`, `lib/`, `public/`, `test/`). No subas `node_modules` ni `data-runtime` (ya están en `.gitignore`).
2. **Render.** Entra a [render.com](https://render.com) con tu cuenta de GitHub → **New → Blueprint** → elige el repositorio. Render lee `render.yaml` y crea el servicio web.
3. **Variables.** Render te pedirá `ANTHROPIC_API_KEY` (tu clave de [console.anthropic.com](https://console.anthropic.com)). Las demás se generan solas.
4. **Claves de acceso.** Cuando termine el despliegue, abre el servicio → **Environment** y copia `ADMIN_PASSWORD` y `SOLICITANTE_PASSWORD`. Si prefieres definirlas tú, edítalas ahí y Render reiniciará el servicio.
5. Abre la URL `https://TU-SERVICIO.onrender.com` e ingresa con `admin` o `solicitante`.

Sin Blueprint también sirve: **New → Web Service**, build `npm install`, start `npm start`, y agrega las variables a mano.

### Importante sobre los datos

En el plan gratuito de Render el disco **no es persistente**: al reiniciar o redesplegar se pierden las cuentas creadas por solicitantes y sus datos, y las emisoras que cargó el administrador. Las cuentas `admin` y `solicitante` se recrean solas. Para conservar todo, usa un plan de pago con disco: descomenta el bloque `disk` de `render.yaml` y define `DATA_DIR=/var/data`. En el plan gratuito el servicio también se "duerme" tras un rato sin visitas y tarda en despertar.

## Probar en tu computador

```bash
npm install
npm start          # http://localhost:3000  (admin / admin1234 y solicitante / solicitante1234, solo en desarrollo)
npm test           # prueba rápida de la API
```

## El mapa de Girón

- Límite municipal aproximado de Girón (DANE, Marco Geoestadístico Nacional 2018, versión **generalizada**) en `public/data/giron-geo.js`. Es muy simplificado: sirve para estimar porcentajes, no para deslindes. Puedes reemplazarlo por uno detallado manteniendo el formato.
- Cobertura de cada emisora con Okumura-Hata y umbral de 66 dBµV/m; porcentaje del municipio cubierto hoy, por el sitio propuesto y en conjunto.
- Solo trae precargada **San Juan de Girón 88.2 FM** (verificada). Las demás las carga el administrador:
  1. Descarga el Excel del [mapa de radio de MinTIC](https://www.mintic.gov.co/portal/maparadio/).
  2. En el mapa, como administrador, usa **Importar el listado oficial de MinTIC**: la app toma solo las filas de Girón (Santander).
  3. Si el archivo no trae coordenadas, las emisoras quedan "sin ubicación" y el administrador las marca en el mapa.
- Las potencias y alturas de torre de emisoras de terceros son estimaciones por categoría, no datos oficiales.
- Las baldosas del mapa vienen de OpenStreetMap (requiere internet).

## Estructura

```
server.js          servidor Express: sesiones, datos por usuario, emisoras, proxy de IA
lib/               prompt del asistente y emisoras iniciales
public/            la aplicación (index.html), Leaflet y lectura de Excel (vendor/), límite de Girón (data/)
test/              prueba de la API
render.yaml        configuración de Render
```

## Seguridad y límites de este prototipo

- Contraseñas con scrypt; sesión en cookie firmada (HttpOnly, 12 h); freno de intentos de acceso; el asistente exige sesión y limita a 60 mensajes por hora por usuario.
- Los datos se guardan en archivos JSON, adecuado para un piloto. Para producción real conviene una base de datos, correos de recuperación de clave y auditoría.
- Las alertas se calculan al abrir la sección; no se envían por correo.
- El asistente usa el modelo definido en `ANTHROPIC_MODEL` (por defecto `claude-sonnet-5-5`).
