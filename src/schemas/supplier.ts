import { z } from 'zod';
import { paginationSchema } from './common';

// Regex pour valider un numéro de téléphone fixe (pas de portable)
// Accepte les formats: 01-09 pour la France (pas 06/07), ou formats internationaux fixes
const landlinePhoneRegex = /^(?:(?:\+|00)33[\s.-]?(?:[1-5]|8|9)[\s.-]?(?:\d{2}[\s.-]?){4}|(?:0[1-5]|0[89])[\s.-]?(?:\d{2}[\s.-]?){4})$/;

// Fonction pour vérifier si c'est un téléphone portable (à rejeter)
const isMobilePhone = (phone: string): boolean => {
  const cleanPhone = phone.replace(/[\s.-]/g, '');
  // Portable français: 06, 07 ou +33 6, +33 7
  return /^(?:(?:\+|00)33[\s.-]?[67]|0[67])/.test(cleanPhone);
};

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(100),
  contact: z.string().max(100).optional(),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  phone: z.string().max(20).optional()
    .refine(
      (val) => !val || !isMobilePhone(val),
      { message: 'Les numéros de téléphone portable ne sont pas acceptés. Utilisez un numéro fixe.' }
    ),
  website: z.string().url('URL invalide').optional().or(z.literal('')),
  address: z.string().optional(),
  postalCode: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  comment: z.string().optional(),
  // Company identifiers (free-form lookup against api.gouv.fr)
  siret: z
    .string()
    .max(14)
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\D/g, '') : v))
    .refine(
      (v) => !v || v.length === 9 || v.length === 14,
      'SIREN (9 chiffres) ou SIRET (14 chiffres) attendu',
    ),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const supplierQuerySchema = paginationSchema.extend({
  // Limite haute pour les listes fournisseurs (selects complets)
  limit: z.coerce.number().int().positive().max(10000).default(20),
  search: z.string().optional(),
  assemblyTypeId: z.string().uuid().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
