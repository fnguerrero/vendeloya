/* ============================================================
   registros.js — historial y borradores, en el KV del Worker.

   Un registro por producto analizado:
     reg:<id>   todo: fotos, análisis, lo editado en la revisión, estado
                y, si salió, el id y el link de la publicación.
     regs       el índice para el historial: solo lo que se muestra en la
                lista (título, precio, estado, miniatura), más nuevo primero.

   Está en la nube y no en el navegador para que lo empezado en la PC se
   pueda terminar en el celu, y para que recargar la página no borre nada.
   ============================================================ */

import { resumenRegistro, actualizarIndice } from './logica.js';

const ID_VALIDO = /^[a-zA-Z0-9-]{8,64}$/;
const CAMPOS = ['fotos', 'thumb', 'analisis', 'publicacion', 'estado', 'ml'];

const err = (mensaje, status) => Object.assign(new Error(mensaje), { status });

function validarId(id) {
  if (!ID_VALIDO.test(id || '')) throw err('Id de registro inválido.', 400);
}

async function indice(env) {
  return (await env.KV.get('regs', 'json')) || [];
}

export async function listar(env) {
  return { registros: await indice(env) };
}

export async function leer(env, id) {
  validarId(id);
  const reg = await env.KV.get(`reg:${id}`, 'json');
  if (!reg) throw err('Ese registro ya no existe.', 404);
  return reg;
}

/** Crea o actualiza: solo pisa los campos que vienen. Las fotos no se reenvían en cada guardado. */
export async function guardar(env, id, cambios) {
  validarId(id);
  const previo = (await env.KV.get(`reg:${id}`, 'json')) || { id, creado: new Date().toISOString() };
  const reg = { ...previo };
  for (const c of CAMPOS) if (c in cambios) reg[c] = cambios[c];
  reg.actualizado = new Date().toISOString();
  await env.KV.put(`reg:${id}`, JSON.stringify(reg));
  await env.KV.put('regs', JSON.stringify(actualizarIndice(await indice(env), resumenRegistro(reg))));
  return { ok: true, id, actualizado: reg.actualizado };
}

export async function borrar(env, id) {
  validarId(id);
  await env.KV.delete(`reg:${id}`);
  await env.KV.put('regs', JSON.stringify((await indice(env)).filter(r => r.id !== id)));
  return { ok: true };
}
