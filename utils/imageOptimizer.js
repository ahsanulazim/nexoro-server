export const imageOptimizer = (url, width, height) => {
  if (!url) return url;

  let transformation = "f_auto,q_auto"; // default optimization

  if (width && height) {
    transformation = `w_${width},h_${height},c_fill,${transformation}`;
  }

  return url.replace("/upload/", `/upload/${transformation}/`);
};
