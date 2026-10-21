import { describe, expect, it } from 'vitest';
import { ETAPA_DE_INTERES, ETAPAS, etapasAnterioresA } from './etapas.rules.js';

describe('etapasAnterioresA', () => {
  it('no hay nada antes de la consulta', () => {
    expect(etapasAnterioresA('consulta')).toEqual([]);
  });

  it('el pago viene después de todas las demás', () => {
    expect(etapasAnterioresA('pagado')).toEqual(ETAPAS.filter((etapa) => etapa !== 'pagado'));
  });

  it('una etapa nunca está entre sus propias anteriores', () => {
    for (const etapa of ETAPAS) expect(etapasAnterioresA(etapa)).not.toContain(etapa);
  });

  it('lo que pidió está más avanzado que lo que vio', () => {
    expect(etapasAnterioresA(ETAPA_DE_INTERES.pidio)).toContain(ETAPA_DE_INTERES.vio);
  });
});
