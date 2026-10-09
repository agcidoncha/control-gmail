# Asistente Comercial Bético

**Documento maestro de proyecto · versión inicial · 8 de octubre de 2026**

> Documento de planificación y continuidad. Describe lo hablado, lo que existe como prototipo y lo que todavía debe decidirse. **No implica que la aplicación real, las integraciones ni las automatizaciones ya estén desarrolladas.**

## 1. Objetivo

Crear un **asistente comercial inteligente conectado a Gmail** para una persona comercial, capaz de controlar conversaciones, detectar seguimientos y compromisos pendientes, preparar correos y responder consultas sobre la actividad comercial mediante lenguaje natural.

La prioridad es **no perder oportunidades ni compromisos** y ahorrar trabajo manual. La aplicación tendrá un panel propio, funcionará desde el navegador en ordenador y móvil y, una vez desplegada, no dependerá de que el Mac de desarrollo esté encendido.

**Alcance inicial:** un solo comercial y su cuenta Gmail, con posibilidad de ampliar posteriormente a varios usuarios o convertirlo en un SaaS, sin complicar innecesariamente la primera versión.

## 2. Estado actual y materiales

- Nombre de trabajo: **Asistente Comercial Bético**.
- Identidad visual elegida: escudo histórico del Real Betis de 1941 y colores indicados por el usuario: Pantone **355 C (verde)**, **131 C (naranja)** y **201 C (rojo)**. Los valores de pantalla son aproximaciones y deben validarse antes de una implementación final.
- Existe un **esquema HTML** de las ocho áreas y sus costes: `asistente-comercial-esquema.html`.
- Existe un **prototipo navegable HTML/CSS/JS**: `asistente-comercial-betico-prototipo.html`, con información ficticia, filtros/navegación y consultas de IA simuladas.
- No se ha integrado realmente Gmail, OpenAI ni MySQL. Tampoco se ha implementado la aplicación de producción.
- En el prototipo el escudo puede depender de un recurso externo (Wikimedia); verificar alojamiento y permisos de uso antes del despliegue público.

## 3. Decisiones y criterios de desarrollo

1. **Primero validar visualmente el prototipo** y los flujos del comercial; después desarrollar la aplicación real.
2. Desarrollo **en el Mac Studio del creador**; producción **en el servidor del cliente**.
3. Infraestructura disponible declarada: servidor con **PHP, Node.js y MySQL**. Se prefiere **Node.js/TypeScript + MySQL** para el backend; PHP queda como alternativa, no como dependencia.
4. Frontend previsto: **Astro + CSS + JavaScript/TypeScript**, responsive.
5. Repositorio **GitHub privado** para versiones y despliegues; secretos fuera del repositorio.
6. Usar **Gmail API** para correo y **OpenAI API** solamente para tareas que requieran interpretación/generación inteligente.
7. **No usar IA para tareas deterministas**: fechas, estados, filtros, alertas, duplicados, estadísticas numéricas y búsquedas exactas.
8. Un correo se analiza cuando se incorpora o cambia de forma relevante; **persistir sus resultados** en MySQL para evitar reprocesar continuamente el historial.
9. Por defecto, los correos redactados por IA quedan **como borradores para aprobación humana**. El envío automático no está aprobado todavía.
10. Ningún cambio real sobre correos o contactos sin diseñar permisos, controles de errores, trazabilidad y límites.

## 4. Arquitectura prevista

```text
                     Navegador (Mac / móvil / tablet)
                                  │
                         Astro (interfaz)
                                  │
                  Node.js + TypeScript (API propia)
                 ┌────────────────┼──────────────────┐
                 │                │                  │
           Gmail API          MySQL            OpenAI API
         OAuth 2.0           clientes,         análisis,
       hilos/mensajes,       mensajes,         clasificación,
          borradores        compromisos,       resúmenes,
                            eventos, logs       redacción
                 │                │                  │
                 └───────────┬────┴──────────────────┘
                             │
                 Trabajos programados (cron)
                  revisiones, alertas y colas
```

**Gmail API no es OpenAI API.** La primera permite acceder al correo con permisos concedidos; la segunda permite invocar modelos de IA y tiene facturación independiente de ChatGPT Plus. El servidor deberá disponer de HTTPS, posibilidad de ejecutar Node de forma estable y un mecanismo de tareas programadas. Estas capacidades deben comprobarse.

**Flujo propuesto:** Gmail sincroniza mensajes → se agrupan por hilo y contacto → la lógica normal detecta estados y plazos → IA extrae compromisos/necesidades cuando aporta valor → MySQL conserva los resultados y la evidencia → el panel muestra pendientes → el comercial aprueba los borradores.

Para una primera versión, una **sincronización periódica** es suficiente. En el futuro puede estudiarse Gmail Push/Google Cloud Pub/Sub, si se justifica.

## 5. Clasificación de las funcionalidades

**Leyenda**

- **Sin IA:** se implementa con Gmail API, Node.js y MySQL (o lógica local de interfaz).
- **Mixto:** puede hacerse con reglas si los datos están estructurados; la IA ayuda cuando el correo es ambiguo o el texto libre requiere interpretación.
- **Con IA:** se propone OpenAI API para comprensión semántica o generación natural; existen alternativas manuales o menos sofisticadas.

> Esta clasificación expresa la **implementación recomendada**, no una obligación de utilizar IA para cualquier variante de la función.

### Área 1. Control de correos

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 1 | Detectar correos sin respuesta | Sin IA | Gmail API, Node.js, MySQL |
| 2 | Avisar a los 5, 10 o 15 días | Sin IA | Cron, Node.js, MySQL |
| 3 | Identificar correos importantes | Mixto | Reglas, Gmail API, OpenAI API opcional |
| 4 | Detectar clientes que dejaron de responder | Sin IA | Gmail API, MySQL |
| 5 | Localizar correos recibidos en spam | Sin IA | Gmail API |
| 6 | Detectar mensajes rebotados | Sin IA | Gmail API, reglas de detección |
| 7 | Evitar seguimientos duplicados | Sin IA | MySQL, lógica de idempotencia |

**Límite importante:** no es posible determinar con certeza si un correo enviado ha terminado en la carpeta spam del destinatario; sí se puede inspeccionar el spam de la cuenta conectada y detectar muchos rebotes.

### Área 2. Seguimiento comercial

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 8 | Identificar clientes pendientes de enviar un briefing | Con IA | OpenAI API, MySQL |
| 9 | Detectar presupuestos enviados sin respuesta | Mixto | Gmail API, reglas, OpenAI API opcional |
| 10 | Detectar propuestas comerciales pendientes | Mixto | Gmail API, MySQL, IA opcional |
| 11 | Extraer compromisos adquiridos por clientes | Con IA | OpenAI API, MySQL |
| 12 | Extraer compromisos del propio comercial | Con IA | OpenAI API, MySQL |
| 13 | Detectar solicitudes de información sin contestar | Mixto | Gmail API, reglas, IA opcional |
| 14 | Señalar oportunidades comerciales olvidadas | Con IA | OpenAI API, estados y antigüedad |

### Área 3. Inteligencia comercial

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 15 | Resumir conversaciones largas | Con IA | OpenAI API |
| 16 | Interpretar necesidades del cliente | Con IA | OpenAI API, MySQL |
| 17 | Identificar señales de interés | Con IA | OpenAI API |
| 18 | Detectar objeciones de precio | Con IA | OpenAI API |
| 19 | Identificar negociaciones | Con IA | OpenAI API |
| 20 | Analizar oportunidades perdidas | Con IA | OpenAI API, MySQL |
| 21 | Recomendar clientes prioritarios | Mixto | Puntuación por reglas + IA opcional |

### Área 4. Automatización de respuestas

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 22 | Redactar respuestas personalizadas | Con IA | OpenAI API, Gmail API |
| 23 | Preparar seguimientos | Mixto | Plantillas, OpenAI API opcional |
| 24 | Preparar mensajes para clientes inactivos | Mixto | Reglas, plantillas, IA opcional |
| 25 | Redactar respuesta a solicitudes de presupuesto | Con IA | OpenAI API, información comercial validada |
| 26 | Agradecimientos tras reuniones | Mixto | Plantillas, calendario opcional, IA |
| 27 | Adaptar el tono al cliente | Con IA | OpenAI API |
| 28 | Guardar borradores para aprobación | Sin IA | Gmail API |

**Regla de seguridad:** no inventar precios, plazos, promesas ni condiciones comerciales. La IA propone, el comercial valida. El envío automático sería una fase posterior con consentimiento y reglas explícitas.

### Área 5. Gestión de clientes

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 29 | Crear fichas de clientes | Mixto | Gmail API, MySQL, extracción IA opcional |
| 30 | Agrupar conversaciones por empresa | Sin IA | Gmail API, MySQL |
| 31 | Consultar historial comercial | Sin IA | MySQL, Gmail API |
| 32 | Identificar responsables de decisiones | Con IA | OpenAI API, revisión humana |
| 33 | Registrar necesidades y preferencias | Con IA | OpenAI API, MySQL |
| 34 | Clasificar estado de negociación | Mixto | Reglas y/o OpenAI API |
| 35 | Identificar contactos inactivos | Sin IA | MySQL, cron |

### Área 6. Agenda y compromisos

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 36 | Extraer fechas y plazos de mensajes | Mixto | Reglas de fechas, OpenAI API opcional |
| 37 | Detectar reuniones pendientes de confirmar | Mixto | Gmail API, reglas, IA opcional |
| 38 | Recordar documentación pendiente | Mixto | MySQL, cron, extracción IA previa |
| 39 | Crear tareas comerciales | Sin IA | Node.js, MySQL |
| 40 | Detectar compromisos incumplidos | Mixto | MySQL, cron, IA para interpretar cumplimiento |
| 41 | Preparar agenda diaria de pendientes | Sin IA | MySQL, cron |

### Área 7. Consultas en lenguaje natural

| Nº | Consulta de ejemplo | Tipo | Tecnología principal |
|---:|---|---|---|
| 42 | «¿Quién está pendiente de enviarme un briefing?» | Con IA | OpenAI API + registros y correos |
| 43 | «¿Qué presupuestos envié sin respuesta?» | Mixto | MySQL, Gmail API, IA opcional |
| 44 | «¿Qué clientes me pidieron descuentos?» | Con IA | OpenAI API, datos extraídos |
| 45 | «¿Con quién hablé sobre la campaña de Navidad?» | Mixto | Búsqueda textual/semántica + IA opcional |
| 46 | «¿Qué clientes tengo más cerca de cerrar?» | Con IA | OpenAI API, datos comerciales |
| 47 | «¿A quién prometí enviar documentación?» | Con IA | OpenAI API, compromisos registrados |
| 48 | «¿Qué oportunidades comerciales tengo abandonadas?» | Mixto | MySQL, reglas, IA opcional |
| 49 | «Resúmeme lo hablado con la empresa X» | Con IA | OpenAI API, mensajes de ese cliente |
| 50 | «¿Qué clientes debería llamar hoy?» | Mixto | Prioridades/reglas, IA opcional |

Para cualquier respuesta importante, mostrar **de qué correo o hilo procede cada afirmación**, con enlace y fecha. Los resultados de IA son sugerencias contrastables, no hechos infalibles.

### Área 8. Informes comerciales

| Nº | Funcionalidad | Tipo | Tecnología principal |
|---:|---|---|---|
| 51 | Resumen diario de correos importantes | Mixto | MySQL, reglas, IA opcional |
| 52 | Informe semanal de actividad | Mixto | MySQL, IA opcional para narrativa |
| 53 | Contar presupuestos enviados | Sin IA | MySQL, Gmail API |
| 54 | Porcentaje de clientes que responden | Sin IA | MySQL |
| 55 | Tiempo medio de respuesta | Sin IA | MySQL |
| 56 | Oportunidades pendientes de cerrar | Sin IA | MySQL |
| 57 | Clientes recuperados mediante seguimiento | Sin IA | MySQL |
| 58 | Informe mensual de actividad | Mixto | MySQL, IA opcional para conclusiones |

## 6. Pantallas previstas (boceto navegable)

- **Panel principal:** indicadores, alertas y actividad relevante.
- **Bandeja comercial:** listado de conversaciones, búsqueda y filtros por cliente, asunto, estado, prioridad y fecha.
- **Seguimientos:** correos sin contestación, ventanas de 5/10/15 días, propuestas de recordatorio.
- **Compromisos:** briefings, documentos, reuniones y promesas pendientes, asignadas a cliente y fecha.
- **Clientes:** contactos, empresas, estado comercial e historial.
- **Borradores:** correos sugeridos por la IA para revisar antes de enviar.
- **Informes:** estadísticas y resumen diario/semanal/mensual.
- **Asistente IA:** entrada tipo prompt para preguntas en lenguaje natural y resultados enlazados a la conversación de origen.

**Diseño:** temática bética, legibilidad, filtros claros, menú hamburguesa en móvil; priorizar una pantalla principal que permita actuar sin recorrer muchos apartados. El HTML de demostración usa datos ficticios, no datos de correo real.

## 7. Estimación de consumo y coste OpenAI API

Los siguientes rangos **son presupuestos ilustrativos**, no cotizaciones ni precios oficiales por correo; dependen del modelo, tamaño de mensajes e hilos, salida generada, consultas y frecuencia de reprocesado.

| Correos analizados por IA en un mes | Media diaria, 22 días laborables | Rango ilustrativo de API al mes |
|---:|---:|---:|
| **300 correos** | ~14 al día | **0,50–2 €** |
| **1.000 correos** | ~45 al día | **2–5 €** |
| **3.000 correos** | ~136 al día | **5–15 €** |
| **5.000 correos** | ~227 al día | **10–30 €** |

**Qué significa «300»:** 300 **mensajes de correo individuales** analizados por la IA en el mes, sean recibidos o enviados. Ejemplo: 200 recibidos + 100 enviados = 300 analizados. **No** significa 300 clientes, 300 hilos ni 300 consultas al asistente.

**Qué incluye analizar un correo:** extraer necesidades, promesas, fechas, intención comercial y posibles tareas en una misma operación. Después, MySQL guarda los resultados y los procesos rutinarios no necesitan invocar la IA.

**Qué puede subir el coste:** hilos extensos, documentos adjuntos, respuestas redactadas, preguntas en lenguaje natural, reanálisis, modelos más potentes y errores/reintentos. Se debe medir el consumo real por operación y limitar el gasto.

**Otros costes distintos:** el alojamiento (ya se dispone de servidor, pero su coste operativo existe), posible dominio/certificado, almacenamiento/backup, y los límites/cuotas del servicio Gmail API. **ChatGPT Plus no incluye créditos para OpenAI API.** La automatización básica con Gmail API no necesita OpenAI API.

**Presupuesto de arranque tentativo para 1.000 correos analizados al mes:** objetivo de unos **2–5 €/mes de IA**, con control y alertas de gasto, sujeto a validación mediante pruebas reales. No prometer este coste sin medir tokens de una muestra representativa.

## 8. Seguridad, privacidad y fiabilidad

- Gmail por **OAuth 2.0**; nunca pedir ni almacenar la contraseña del buzón.
- Solicitar permisos mínimos y estudiar las condiciones/verificación de Google para los ámbitos OAuth necesarios, especialmente si se comercializa a terceros.
- Guardar claves API y tokens de acceso cifrados/seguros; nunca en el frontend ni en GitHub.
- HTTPS, control de acceso, backups, auditoría y borrado de datos.
- Reducir el contenido enviado a la IA a lo imprescindible; verificar obligaciones de protección de datos y tratamiento de información comercial.
- No enviar correos duplicados: usar IDs de mensajes/hilos, estados y registros de acción.
- Detectar cambios en la conversación **antes** de preparar o enviar un seguimiento.
- Gestionar rebotes, respuestas automáticas, listas de exclusión y solicitudes de no contacto.
- Permitir corregir compromisos mal interpretados por la IA.
- Mantener evidencia de origen (mensaje y fecha) para cada compromiso extraído.

## 9. Fases de trabajo propuestas

### Fase 0. Validación UX
Validar con el comercial el boceto HTML: pantallas, navegación, filtros, prioridades y contenido. No conectar cuentas ni gastar tokens.

### Fase 1. Base funcional sin IA
Crear proyecto Astro/Node/MySQL; autenticación; conectar Gmail OAuth; listar hilos y detectar respuestas; mostrar pendientes y fechas; sincronización programada; pruebas con una cuenta autorizada. **Sin envíos automáticos.**

### Fase 2. Seguimientos y tareas
Estados y reglas (5/10/15 días), fichas de clientes, compromisos manuales, borradores mediante plantillas, avisos y registro de acciones.

### Fase 3. IA controlada
Análisis estructurado de correos, extracción de compromisos, resúmenes, propuestas de redacción y consultas naturales. Guardar resultados y fuente. Medir tokens y errores antes de activar el procesamiento general.

### Fase 4. Despliegue y endurecimiento
Instalar en servidor Node/MySQL existente; verificar procesos persistentes y cron; configurar HTTPS, dominio, backup, supervisión y permisos reales de Gmail. Pruebas completas antes de producción.

### Fase 5. Posibles ampliaciones
Más cuentas/usuarios, roles, panel avanzado, integraciones con calendario/Airtable, avisos inteligentes, notificaciones push, SaaS multiempresa. **No son requisitos de la primera versión.**

## 10. Pendiente de definir antes de programar

1. Confirmar el **flujo real** del comercial (volumen, tipos de clientes, estructura de correos).
2. Decidir qué mensajes se consideran **comerciales** y cuáles se excluyen (personales, newsletters, automáticos).
3. Elegir los plazos exactos de seguimiento: inicialmente se ha hablado de **10 días**; 5/15 serían configurables.
4. Confirmar si se usan días naturales o laborables y qué ocurre tras recibir una respuesta.
5. Definir si el programa solo **genera borradores** o algún día podrá enviarlos automáticamente; por ahora priorizar aprobación.
6. Confirmar políticas de retención, tratamiento de adjuntos y privacidad.
7. Comprobar servidor remoto: versión Node, acceso SSH, procesos persistentes, cron, SSL y MySQL.
8. Definir estrategia de autorización Google OAuth y posibles requisitos de publicación/verificación.
9. Validar pantallas, filtros y campos del boceto.
10. Hacer prueba de coste real con una muestra de mensajes y el modelo elegido; evitar tomar las estimaciones como garantías.

## 11. Primer paso recomendado

**Revisar el prototipo HTML con el comercial y cerrar la interfaz y el flujo de «correo enviado → sin respuesta a los 10 días → borrador de seguimiento → aprobación».** Solo después conectar Gmail y comenzar la implementación en local.

---

### Archivos relacionados

- `asistente-comercial-esquema.html`: explicación visual de las ocho áreas y los costes.
- `asistente-comercial-betico-prototipo.html`: boceto de la aplicación en HTML/CSS/JavaScript.
- `asistente-comercial-betico-proyecto.md`: este documento maestro.
