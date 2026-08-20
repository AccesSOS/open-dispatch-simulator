# Source & License — mx-cnie-911

This pack is grounded on:

> **Catálogo Nacional de Incidentes de Emergencia (CNIE), v3.0** — edición oficial, junio 2024
> Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública (SESNSP), Centro Nacional de Información
> [Official PDF on gob.mx](https://www.gob.mx/cms/uploads/attachment/file/927338/CNIE_V_3.0_Oficial_junio_24.pdf) · [SESNSP normateca](https://www.gob.mx/sesnsp/documentos/catalogos-normateca-sesnsp)

The CNIE is the normative classification instrument for every Mexican 9-1-1 call center (CALLE):
standardized incident codes, names, definitions, and *atención* priorities, in force nationwide
since 2016.

## License

gob.mx publishes under Mexico's open-use terms (**Libre Uso MX**,
<https://datos.gob.mx/libreusomx>), which permit use and redistribution with attribution; the
catalog is additionally a normative instrument of the Sistema Nacional de Seguridad Pública
(government-edict character). Attribution: SESNSP / Centro Nacional de Información.

## What is (and is not) from the source

**From the CNIE, verbatim:** incident codes, names, definitions, and priorities — 10314
Infarto/Urgencia cardiológica, 10313 Paro cardiorrespiratorio, 10308 Persona inconsciente,
10305 Dificultad respiratoria, 10307 Convulsiones, 10224 Deshidratación (MEDIA), 10310 Urgencia
por enfermedad general (fallback). The infarto key questions are drawn from the catalog's own
symptom list. The case-entry jumps implement CNIE *reclassification by definition* (unconscious +
not breathing **is** 10313; unconscious but breathing **is** 10308).

**Editorial (not in the source):** the CNIE is a classification catalog, not an interrogation
script — the case-entry wording and remaining key questions are this project's. Post-dispatch
lines are deliberately minimal and non-medical; the CNIE contains no pre-arrival instructions and
we invent none.

## Operational warning

SIMULATION ONLY — for testing, research, and practice. Not certified for live emergency
call-taking. Real CALLE centers operate under SESNSP norms and their own operating procedures.
