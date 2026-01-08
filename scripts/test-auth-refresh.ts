import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../src/auth/auth.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const authService = app.get<AuthService>(AuthService as any);
    const userModel = app.get('UserModel');

    const email = 'test-refresh@example.com';
    const plain = 'Password123!';
    const deviceId = 'test-device-1';

    let user = await userModel.findOne({ email });
    if (!user) {
      const hashed = await bcrypt.hash(plain, 10);
      user = new userModel({
        id: 'testusr',
        email,
        password: hashed,
        proveedor: null,
        isActive: true,
        monedaPrincipal: 'MXN',
        monedaPreferencia: 'MXN',
        nombreCompleto: 'Test Refresh',
        edad: 30,
        ocupacion: 'dev',
      });
      await user.save();
      console.log('Created test user');
    } else {
      console.log('Test user exists');
    }

    // Login
    console.log('\n--- LOGIN ---');
    const loginRes: any = await authService.login({ email, password: plain, deviceId });
    console.log('Login result keys:', Object.keys(loginRes));
    const { accessToken, refreshToken } = loginRes as any;

    // Refresh
    console.log('\n--- REFRESH ---');
    const refreshRes: any = await authService.refreshTokens({ refreshToken, deviceId });
    console.log('Refresh result:', refreshRes);

    // Logout
    console.log('\n--- LOGOUT ---');
    const logoutRes: any = await authService.logout(user.id, deviceId);
    console.log('Logout result:', logoutRes);

  } catch (err: any) {
    console.error('Test error:', err?.message || err);
  } finally {
    await app.close();
  }
}

main();
