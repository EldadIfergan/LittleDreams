export function validateAvatar(value) {
  if (typeof value !== 'string' || value.length > 45000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || !Buffer.from(value.split(',')[1], 'base64').subarray(0,3).equals(Buffer.from([255,216,255]))) {
    throw Object.assign(new Error('תמונת הפרופיל אינה תקינה'), {status:400});
  }
  return value;
}
