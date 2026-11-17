import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Lo que vuelve del popup de Embedded Signup. Ningún dato se cree tal cual:
 * `MetaWhatsappService.verificar` canjea el código y confirma contra Meta que
 * el número es de esa WABA.
 */
export class SignupMetaDto {
  @IsString()
  @MaxLength(2048)
  @Matches(/^[\w\-.~+/=]+$/, { message: 'Código de Meta inválido.' })
  code!: string;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'Cuenta de WhatsApp Business inválida.' })
  wabaId!: string;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'Número de WhatsApp Business inválido.' })
  phoneNumberId!: string;

  /** Si el número sigue en la app WhatsApp Business (coexistencia). Sólo decide registrar o sincronizar. */
  @IsBoolean()
  coexistencia!: boolean;
}
