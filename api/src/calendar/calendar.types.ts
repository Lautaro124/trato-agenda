import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body de PATCH /calendar/eventos/:eventId — todos los campos son opcionales, se parchea sólo lo que venga. */
export class EditarEventoDto {
  @IsISO8601()
  @IsOptional()
  inicio?: string;

  @IsISO8601()
  @IsOptional()
  fin?: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  resumen?: string;
}

/** Body de POST /calendar/eventos — bloquear un horario a mano desde /calendario. */
export class CrearEventoDto {
  @IsISO8601()
  inicio!: string;

  @IsISO8601()
  fin!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  resumen!: string;
}
