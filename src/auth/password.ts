import bcrypt from "bcryptjs";

export const hashSecret = async (plain: string) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
};

export const verifySecret = async (plain: string, hash: string) => {
  return bcrypt.compare(plain, hash);
};

