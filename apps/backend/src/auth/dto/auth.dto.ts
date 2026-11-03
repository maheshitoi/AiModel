import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128; // bounds hashing cost for hostile input

export class LoginDto {
  @ApiProperty({ example: 'admin@myownai.local' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}
