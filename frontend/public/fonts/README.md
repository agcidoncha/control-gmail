# Fuentes del Asistente Comercial

Esta es la carpeta central de tipografías del frontend. Actualmente usamos dos familias:

## Gotham

Se utiliza para títulos, marca, botones y elementos destacados.

```text
Gotham/Gotham Regular.woff2  → 400
Gotham/Gotham Medium.woff2   → 500
Gotham/Gotham Bold.woff2     → 700
Gotham/Gotham Black.woff2    → 900
```

## Montserrat

Se utiliza para textos de lectura, formularios y contenido general.

```text
Montserrat/Montserrat-ExtraLight.woff2 → 200
Montserrat/Montserrat-Regular.woff2    → 400
Montserrat/Montserrat-Medium.woff2     → 500
Montserrat/Montserrat-Bold.woff2       → 700
Montserrat/Montserrat-Black.woff2      → 900
```

La aplicación carga ambas familias desde `fonts.css`. No depende de que la fuente esté instalada en el ordenador del usuario.

Cuando incorporemos otra fuente, sus archivos deben ir aquí y servirse desde:

```text
/fonts/nombre-de-la-fuente.woff2
```

## Formato recomendado

- Preferir `.woff2` por tamaño y rendimiento.
- Añadir `.woff` solo como alternativa si hace falta compatibilidad adicional.
- Evitar subir `.otf` o `.ttf` salvo que sean necesarios para generar las versiones web.
- Mantener únicamente los pesos que realmente utilicemos: por ejemplo `400`, `500`, `700` y `800`.

## Convención de nombres

```text
familia-peso-estilo.woff2
```

Ejemplos:

```text
inter-400-normal.woff2
inter-700-normal.woff2
```

## Cómo está conectado al diseño

Las declaraciones `@font-face` están en [fonts.css](fonts.css) y se cargan desde el layout principal y la pantalla de acceso. Se usan mediante variables CSS:

```css
--font-body: "Montserrat", ...;
--font-display: "Gotham", "Montserrat", ...;
```

Así podemos cambiar la tipografía desde un único sitio sin modificar cada pantalla.

Antes de añadir una fuente descargada hay que comprobar su licencia y conservar, si procede, el archivo de licencia junto a ella.

