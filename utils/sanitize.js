import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { decode } from "html-entities";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

export function sanitizeAndNormalize(content) {
    const cleanHTML = DOMPurify.sanitize(content);
    const normalized = decode(cleanHTML);
    return normalized;
}
