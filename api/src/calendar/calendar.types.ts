import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

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
