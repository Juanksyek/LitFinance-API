// Mock común para ConversionService
export const mockConversionService = {
  convertir: jest.fn().mockImplementation((monto, desde, hacia) => ({
    montOriginal: monto,
    monedaOrigen: desde,
    montoConvertido: monto,
    monedaDestino: hacia,
    tasaCambio: 1,
  })),
  obtenerTasaCambio: jest.fn().mockResolvedValue(1),
};

// Mock común para ConceptoPersonalizadoModel
export const mockConceptoPersonalizadoModel = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
};

// Mock común para UserModel
export const mockUserModel = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({}),
};
