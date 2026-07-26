import { IsString, MinLength } from 'class-validator';

export class SearchUserDto {
  @IsString()
  @MinLength(1)
  q!: string;
}