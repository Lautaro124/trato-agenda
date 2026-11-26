import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type User } from '../generated/prisma/client.js';
import type { Email, EmailService } from '../email/email.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MAX_INTENTOS_POR_CODIGO } from './codigo-acceso.service.js';
import { EmailRecuperacionService, normalizarEmail } from './email-recuperacion.service.js';
import { hashearPassword } from './password.js';

type Fila = { id: string; userId: string; email: string; hash: string; expiraAt: Date; intentos: number };

const PASSWORD = 'una-clave-larga';
let hashDePassword: string;

function usuario(parcial: Partial<User> = {}): User {
  return {
    id: 'user-1',
    googleId: null,
    email: null,
    name: null,
    avatarUrl: null,
    phoneNumber: '5491122334455',
    emailRecuperacion: null,
    emailVerificadoAt: null,
    passwordHash: hashDePassword,
    ...parcial,
  } as User;
}

function crear(opciones: { disponible?: boolean; envioOk?: boolean; emailEnOtraCuenta?: boolean } = {}) {
  let fila: Fila | null = null;
  const prisma = {
    verificacionEmail: {
      upsert: vi.fn().mockImplementation(({ create, update }: { create: Fila; update: Partial<Fila> }) => {
        fila = fila ? { ...fila, ...update } : { ...create, id: 'v1', intentos: 0 };
        return fila;
      }),
      findUnique: vi.fn().mockImplementation(() => fila),
      update: vi.fn().mockImplementation(() => {
        fila!.intentos++;
        return fila;
      }),
      delete: vi.fn().mockImplementation(() => {
        fila = null;
      }),
      deleteMany: vi.fn().mockImplementation(() => {
        fila = null;
        return { count: 1 };
      }),
    },
    user: {
      update: vi.fn().mockImplementation(({ data }: { data: Partial<User> }) => usuario(data)),
    },
    $transaction: vi.fn().mockImplementation(async (operaciones: Promise<unknown>[]) => {
      if (opciones.emailEnOtraCuenta) {
        throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      }
      return Promise.all(operaciones);
    }),
  } as unknown as PrismaService;

  const enviados: Email[] = [];
  const emails = {
    disponible: () => opciones.disponible ?? true,
    enviar: vi.fn().mockImplementation((email: Email) => {
      if (opciones.envioOk === false) return Promise.resolve(false);
      enviados.push(email);
      return Promise.resolve(true);
    }),
  } as unknown as EmailService;

  const service = new EmailRecuperacionService(prisma, emails);
  const codigoEnviado = () => enviados.at(-1)!.texto.match(/\d{6}/)![0];
  return { service, prisma, emails, enviados, codigoEnviado, fila: () => fila };
}

describe('EmailRecuperacionService', () => {
  beforeEach(async () => {
    hashDePassword ??= await hashearPassword(PASSWORD);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('manda un código a la dirección nueva y no la guarda en la cuenta hasta confirmarla', async () => {
    const { service, prisma, enviados, fila } = crear();

    await service.solicitar(usuario(), '  Titular@Ejemplo.com ', PASSWORD);

    expect(enviados[0].para).toBe('titular@ejemplo.com');
    expect(fila()?.email).toBe('titular@ejemplo.com');
    expect(fila()?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('con el código correcto queda verificado y la verificación se consume', async () => {
    const { service, codigoEnviado, fila } = crear();
    await service.solicitar(usuario(), 'titular@ejemplo.com', PASSWORD);

    const actualizado = await service.confirmar(usuario(), codigoEnviado());

    expect(actualizado.emailRecuperacion).toBe('titular@ejemplo.com');
    expect(actualizado.emailVerificadoAt).toBeInstanceOf(Date);
    expect(fila()).toBeNull();
  });

  it('pide la contraseña actual: una sesión robada no alcanza para redirigir la recuperación', async () => {
    const { service, emails } = crear();

    await expect(service.solicitar(usuario(), 'otro@ejemplo.com', 'incorrecta')).rejects.toThrow('contraseña actual');
    expect(emails.enviar).not.toHaveBeenCalled();
  });

  it('una cuenta sin contraseña tiene que elegirla primero', async () => {
    const { service } = crear();

    await expect(service.solicitar(usuario({ passwordHash: null }), 'a@b.com', 'x')).rejects.toThrow('contraseña');
  });

  it('sin proveedor de email contesta 503 y no guarda nada', async () => {
    const { service, fila } = crear({ disponible: false });

    await expect(service.solicitar(usuario(), 'a@b.com', PASSWORD)).rejects.toThrow('Todavía no podemos');
    expect(fila()).toBeNull();
  });

  it('si el envío falla no deja una verificación pendiente', async () => {
    const { service, fila } = crear({ envioOk: false });

    await expect(service.solicitar(usuario(), 'a@b.com', PASSWORD)).rejects.toThrow('No pudimos mandar');
    expect(fila()).toBeNull();
  });

  it('vence a los 10 minutos', async () => {
    const { service, codigoEnviado } = crear();
    await service.solicitar(usuario(), 'a@b.com', PASSWORD);

    vi.setSystemTime(new Date('2026-11-25T12:10:00Z'));
    await expect(service.confirmar(usuario(), codigoEnviado())).rejects.toThrow('no es válido');
  });

  it(`después de ${MAX_INTENTOS_POR_CODIGO} intentos fallidos ni el correcto sirve`, async () => {
    const { service, codigoEnviado } = crear();
    await service.solicitar(usuario(), 'a@b.com', PASSWORD);
    const correcto = codigoEnviado();
    const incorrecto = correcto === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_INTENTOS_POR_CODIGO; i++) {
      await expect(service.confirmar(usuario(), incorrecto)).rejects.toThrow('no es válido');
    }
    await expect(service.confirmar(usuario(), correcto)).rejects.toThrow('no es válido');
  });

  it('sin pedido previo ningún código sirve', async () => {
    const { service } = crear();

    await expect(service.confirmar(usuario(), '123456')).rejects.toThrow('no es válido');
  });

  it('al cambiarlo le avisa a la dirección anterior', async () => {
    const { service, enviados, codigoEnviado } = crear();
    const conEmail = usuario({ emailRecuperacion: 'viejo@ejemplo.com' });
    await service.solicitar(conEmail, 'nuevo@ejemplo.com', PASSWORD);

    await service.confirmar(conEmail, codigoEnviado());

    expect(enviados.at(-1)).toMatchObject({ para: 'viejo@ejemplo.com', asunto: expect.stringContaining('Cambió') });
  });

  it('el mismo email que ya tiene no manda nada', async () => {
    const { service, emails } = crear();

    await expect(
      service.solicitar(usuario({ emailRecuperacion: 'a@b.com' }), 'A@B.com', PASSWORD),
    ).rejects.toThrow('Ese ya es');
    expect(emails.enviar).not.toHaveBeenCalled();
  });

  it('un email que ya es de otra cuenta da 409 y no queda pendiente', async () => {
    const { service, codigoEnviado, fila } = crear({ emailEnOtraCuenta: true });
    await service.solicitar(usuario(), 'a@b.com', PASSWORD);

    await expect(service.confirmar(usuario(), codigoEnviado())).rejects.toThrow('otra cuenta');
    expect(fila()).toBeNull();
  });

  it('limita los pedidos por cuenta', async () => {
    const { service } = crear();
    await service.solicitar(usuario(), 'a@b.com', PASSWORD);

    await expect(service.solicitar(usuario(), 'c@d.com', PASSWORD)).rejects.toThrow('Esperá');
  });

  it('avisa el cambio de contraseña sólo si hay email de recuperación', () => {
    const { service, emails } = crear();

    service.avisarCambioDePassword({ emailRecuperacion: null });
    expect(emails.enviar).not.toHaveBeenCalled();

    service.avisarCambioDePassword({ emailRecuperacion: 'a@b.com' });
    expect(emails.enviar).toHaveBeenCalledWith(expect.objectContaining({ para: 'a@b.com' }));
  });

  it('normaliza espacios y mayúsculas', () => {
    expect(normalizarEmail('  Hola@Trato.COM ')).toBe('hola@trato.com');
  });
});

