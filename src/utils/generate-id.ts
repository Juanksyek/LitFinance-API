import { Model } from 'mongoose';

export const generateUniqueId = async (
  model: Model<any>,
  field: string = 'subsubCuentaId',
  length = 7,
): Promise<string> => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id: string;
  let exists: any;

  do {
    id = '';
    for (let i = 0; i < length; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const query: any = {};
    query[field] = id;
    exists = await model.findOne(query);
  } while (exists);

  return id;
};