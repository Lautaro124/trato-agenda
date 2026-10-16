/**
 * Fórmulas de las recetas de cotización (LAU-26), como funciones puras: un
 * tokenizador y un parser de descenso recursivo propios, **sin `eval` ni
 * `Function` ni dependencias**. Lo que escribe el dueño ("ancho × alto ÷
 * 10000 × 1,1") nunca se ejecuta como código: se convierte en un árbol que
 * sólo sabe sumar, restar, multiplicar, dividir y llamar a cuatro funciones.
 *
 * Gramática (como una planilla en español: coma decimal, `;` entre argumentos):
 *
 *   expr    := termino (("+" | "-") termino)*
 *   termino := unario (("*" | "×" | "/" | "÷") unario)*
 *   unario  := "-" unario | primario
 *   primario:= numero | variable | funcion "(" expr (";" expr)* ")" | "(" expr ")"
 */

export const LARGO_MAX_FORMULA = 200;
/** Nodos y profundidad del árbol: una fórmula de receta es corta, esto frena lo patológico. */
export const MAX_NODOS_FORMULA = 100;
export const MAX_PROFUNDIDAD_FORMULA = 20;

/** Nombre de variable: lo que el dueño ve en el botón ("ancho", "alto_cm"). */
export const PATRON_VARIABLE = /^[a-z_][a-z0-9_]{0,29}$/;

export const FUNCIONES_FORMULA = {
  /** Para arriba: planchas, latas o rollos enteros. */
  techo: { minimo: 1, maximo: 1, aplicar: (args: number[]) => Math.ceil(args[0]) },
  /** Al entero más cercano. */
  redondear: { minimo: 1, maximo: 1, aplicar: (args: number[]) => Math.round(args[0]) },
  min: { minimo: 2, maximo: 10, aplicar: (args: number[]) => Math.min(...args) },
  max: { minimo: 2, maximo: 10, aplicar: (args: number[]) => Math.max(...args) },
} as const;

export type FuncionFormula = keyof typeof FUNCIONES_FORMULA;

export type NodoFormula =
  | { t: 'num'; v: number }
  | { t: 'var'; n: string }
  | { t: 'neg'; a: NodoFormula }
  | { t: 'op'; o: '+' | '-' | '*' | '/'; a: NodoFormula; b: NodoFormula }
  | { t: 'fn'; f: FuncionFormula; args: NodoFormula[] };

export type ResultadoParseo = { ok: true; ast: NodoFormula; variables: string[] } | { ok: false; error: string };
export type ResultadoEvaluacion = { ok: true; valor: number } | { ok: false; error: string };

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: ';'; v: ';' };

function esFuncion(nombre: string): nombre is FuncionFormula {
  return Object.prototype.hasOwnProperty.call(FUNCIONES_FORMULA, nombre);
}

/** Texto → tokens. Cualquier caracter fuera de la gramática es un error con su posición. */
function tokenizar(texto: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const numero = /^\d+(?:[.,]\d+)?/.exec(texto.slice(i));
    if (numero) {
      tokens.push({ t: 'num', v: Number(numero[0].replace(',', '.')) });
      i += numero[0].length;
      continue;
    }
    const nombre = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(texto.slice(i));
    if (nombre) {
      tokens.push({ t: 'id', v: nombre[0].toLowerCase() });
      i += nombre[0].length;
      continue;
    }
    if (c === '+' || c === '-') tokens.push({ t: 'op', v: c });
    else if (c === '*' || c === '×') tokens.push({ t: 'op', v: '*' });
    else if (c === '/' || c === '÷') tokens.push({ t: 'op', v: '/' });
    else if (c === '(') tokens.push({ t: '(', v: '(' });
    else if (c === ')') tokens.push({ t: ')', v: ')' });
    else if (c === ';') tokens.push({ t: ';', v: ';' });
    else return { error: `No entiendo "${c}" en la fórmula (posición ${i + 1}).` };
    i += 1;
  }
  return tokens;
}

class ErrorDeFormula extends Error {}

/**
 * Valida y arma el árbol de una fórmula. Sólo acepta las variables que se le
 * pasan (las preguntas de número del producto): una variable desconocida es
 * un error, nunca un cero.
 */
export function parsearFormula(texto: string, variablesPermitidas: ReadonlySet<string>): ResultadoParseo {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: 'La fórmula está vacía.' };
  if (limpio.length > LARGO_MAX_FORMULA) {
    return { ok: false, error: `La fórmula puede tener hasta ${LARGO_MAX_FORMULA} caracteres.` };
  }
  const tokens = tokenizar(limpio);
  if ('error' in tokens) return { ok: false, error: tokens.error };

  let posicion = 0;
  let nodos = 0;
  const usadas = new Set<string>();
  const siguiente = () => tokens[posicion];
  const contar = (profundidad: number) => {
    nodos += 1;
    if (nodos > MAX_NODOS_FORMULA) throw new ErrorDeFormula('La fórmula es demasiado larga.');
    if (profundidad > MAX_PROFUNDIDAD_FORMULA) throw new ErrorDeFormula('La fórmula tiene demasiados paréntesis anidados.');
  };

  function expr(profundidad: number): NodoFormula {
    let izquierda = termino(profundidad);
    for (let token = siguiente(); token?.t === 'op' && (token.v === '+' || token.v === '-'); token = siguiente()) {
      posicion += 1;
      contar(profundidad);
      izquierda = { t: 'op', o: token.v, a: izquierda, b: termino(profundidad) };
    }
    return izquierda;
  }

  function termino(profundidad: number): NodoFormula {
    let izquierda = unario(profundidad);
    for (let token = siguiente(); token?.t === 'op' && (token.v === '*' || token.v === '/'); token = siguiente()) {
      posicion += 1;
      contar(profundidad);
      izquierda = { t: 'op', o: token.v, a: izquierda, b: unario(profundidad) };
    }
    return izquierda;
  }

  function unario(profundidad: number): NodoFormula {
    const token = siguiente();
    if (token?.t === 'op' && token.v === '-') {
      posicion += 1;
      contar(profundidad + 1);
      return { t: 'neg', a: unario(profundidad + 1) };
    }
    return primario(profundidad);
  }

  function primario(profundidad: number): NodoFormula {
    const token = siguiente();
    contar(profundidad);
    if (!token) throw new ErrorDeFormula('La fórmula termina antes de tiempo: le falta un número o un dato.');
    if (token.t === 'num') {
      posicion += 1;
      return { t: 'num', v: token.v };
    }
    if (token.t === '(') {
      posicion += 1;
      const adentro = expr(profundidad + 1);
      if (siguiente()?.t !== ')') throw new ErrorDeFormula('Falta cerrar un paréntesis.');
      posicion += 1;
      return adentro;
    }
    if (token.t === 'id') {
      posicion += 1;
      if (siguiente()?.t === '(') {
        if (!esFuncion(token.v)) throw new ErrorDeFormula(`"${token.v}" no es una función (hay techo, redondear, min y max).`);
        posicion += 1;
        const args = [expr(profundidad + 1)];
        while (siguiente()?.t === ';') {
          posicion += 1;
          args.push(expr(profundidad + 1));
        }
        if (siguiente()?.t !== ')') throw new ErrorDeFormula(`Falta cerrar el paréntesis de ${token.v}.`);
        posicion += 1;
        const { minimo, maximo } = FUNCIONES_FORMULA[token.v];
        if (args.length < minimo || args.length > maximo) {
          throw new ErrorDeFormula(
            minimo === maximo
              ? `${token.v} lleva ${minimo} valor${minimo === 1 ? '' : 'es'}.`
              : `${token.v} lleva entre ${minimo} y ${maximo} valores separados por ";".`,
          );
        }
        return { t: 'fn', f: token.v, args };
      }
      if (esFuncion(token.v)) throw new ErrorDeFormula(`${token.v} va con paréntesis: ${token.v}(…).`);
      if (!variablesPermitidas.has(token.v)) {
        throw new ErrorDeFormula(`"${token.v}" no es una pregunta de número de este producto.`);
      }
      usadas.add(token.v);
      return { t: 'var', n: token.v };
    }
    throw new ErrorDeFormula(
      token.t === ')' ? 'Sobra un paréntesis de cierre.' : token.t === ';' ? 'El ";" sólo separa valores dentro de una función.' : 'Falta un número o un dato antes de la operación.',
    );
  }

  try {
    const ast = expr(0);
    if (posicion < tokens.length) {
      const sobra = tokens[posicion];
      throw new ErrorDeFormula(
        sobra.t === ')' ? 'Sobra un paréntesis de cierre.' : 'Faltan operaciones entre los números o datos (por ejemplo, un ×).',
      );
    }
    return { ok: true, ast, variables: [...usadas] };
  } catch (error) {
    if (error instanceof ErrorDeFormula) return { ok: false, error: error.message };
    throw error;
  }
}

/** Calcula el valor de un árbol con los números que contestó el cliente. Nunca lanza. */
export function evaluarFormula(ast: NodoFormula, valores: Readonly<Record<string, number>>): ResultadoEvaluacion {
  try {
    const valor = evaluar(ast, valores);
    if (!Number.isFinite(valor)) return { ok: false, error: 'La cuenta no da un número (¿una división por cero?).' };
    return { ok: true, valor };
  } catch (error) {
    if (error instanceof ErrorDeFormula) return { ok: false, error: error.message };
    throw error;
  }
}

function evaluar(nodo: NodoFormula, valores: Readonly<Record<string, number>>): number {
  switch (nodo.t) {
    case 'num':
      return nodo.v;
    case 'var': {
      const valor = Object.prototype.hasOwnProperty.call(valores, nodo.n) ? valores[nodo.n] : undefined;
      if (valor === undefined || !Number.isFinite(valor)) throw new ErrorDeFormula(`Falta el dato "${nodo.n}".`);
      return valor;
    }
    case 'neg':
      return -evaluar(nodo.a, valores);
    case 'op': {
      const a = evaluar(nodo.a, valores);
      const b = evaluar(nodo.b, valores);
      if (nodo.o === '/' && b === 0) throw new ErrorDeFormula('La cuenta divide por cero.');
      return nodo.o === '+' ? a + b : nodo.o === '-' ? a - b : nodo.o === '*' ? a * b : a / b;
    }
    case 'fn':
      return FUNCIONES_FORMULA[nodo.f].aplicar(nodo.args.map((arg) => evaluar(arg, valores)));
  }
}

/** Atajo: parsear y evaluar de una. */
export function calcularFormula(
  texto: string,
  valores: Readonly<Record<string, number>>,
): ResultadoEvaluacion {
  const parseo = parsearFormula(texto, new Set(Object.keys(valores)));
  return parseo.ok ? evaluarFormula(parseo.ast, valores) : parseo;
}
