import { BadRequestException, type ExecutionContext, UnsupportedMediaTypeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SoloTextoGuard } from './mejoras.controller.js';

function contexto(contentType: string | undefined, body: unknown): ExecutionContext {
  const req = {
    body,
    is: (tipo: string) => (contentType?.startsWith(tipo) ? tipo : false),
  };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('SoloTextoGuard', () => {
  const guard = new SoloTextoGuard();

  it('deja pasar JSON con tipo y texto', () => {
    expect(guard.canActivate(contexto('application/json; charset=utf-8', { tipo: 'idea', texto: 'Hola mundo' }))).toBe(
      true,
    );
  });

  it('rechaza todo lo que no es JSON (archivos incluidos)', () => {
    expect(() => guard.canActivate(contexto('multipart/form-data; boundary=x', {}))).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => guard.canActivate(contexto('text/html', {}))).toThrow(UnsupportedMediaTypeException);
    expect(() => guard.canActivate(contexto(undefined, {}))).toThrow(UnsupportedMediaTypeException);
  });

  it('rechaza campos de más en vez de descartarlos', () => {
    expect(() =>
      guard.canActivate(contexto('application/json', { tipo: 'idea', texto: 'Hola mundo', archivo: 'x' })),
    ).toThrow(BadRequestException);
  });

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(() => guard.canActivate(contexto('application/json', ['idea']))).toThrow(BadRequestException);
    expect(() => guard.canActivate(contexto('application/json', 'hola'))).toThrow(BadRequestException);
  });
});
