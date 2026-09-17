import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from './password.js';

/** Reglas de una contraseña nueva, compartidas por todos los DTO que la reciben. */
export function ReglasDePassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN, { message: `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.` }),
    MaxLength(PASSWORD_MAX),
  );
}
