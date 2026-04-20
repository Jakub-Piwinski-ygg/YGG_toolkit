export function getImageDimensions(uint8) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([uint8], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read dimensions'));
    };
    img.src = url;
  });
}

export async function freshBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
