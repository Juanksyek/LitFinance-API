import { Model } from 'mongoose';
import { randomBytes } from 'crypto';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateBase62String(length: number): string {
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += BASE62[bytes[i] % BASE62.length];
  }
  return id;
}

export const generateUniqueId = async (
  model: Model<any>,
  field: string = 'id',
  length: number = 7,
  maxTries: number = 5,
): Promise<string> => {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const id = generateBase62String(length);
    const exists = await model.exists({ [field]: id });

    if (!exists) {
      return id;
    }
  }

  throw new Error(`No se pudo generar un ID único después de ${maxTries} intentos.`);
};