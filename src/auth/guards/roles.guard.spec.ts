import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  it('debe estar definido', () => {
    const mockReflector = {} as Reflector;
    expect(new RolesGuard(mockReflector)).toBeDefined();
  });
});
