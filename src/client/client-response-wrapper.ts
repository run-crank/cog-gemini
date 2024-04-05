import { GenerateContentResult } from "@google/generative-ai";

export class ClientResponseWrapper {
  private originalClass: object;

  public response_time: number;

  public request_payload: object;

  public text_response: string;

  public usage: object;

  constructor(originalClass: GenerateContentResult, responseTime: number, requestPrompt: string, promptTokenUsage: number, responseTokenUsage: number) {
    this.originalClass = JSON.parse(JSON.stringify(originalClass.response, null, 2));
    this.copyProperties();
    this.response_time = responseTime;
    this.request_payload = {'prompt': requestPrompt};
    this.text_response = this.originalClass['candidates'][0].content.parts[0].text;
    this.usage = {      
      input_tokens: promptTokenUsage,
      output_tokens: responseTokenUsage,
      total_tokens: promptTokenUsage + responseTokenUsage,
    }
  }

  copyProperties() {
    for (const prop in this.originalClass) {
      // Using Object.prototype.hasOwnProperty.call() for safer property check
      if (Object.prototype.hasOwnProperty.call(this.originalClass, prop)) {
        // Use Object.defineProperty to copy property descriptor
        Object.defineProperty(
          this,
          prop,
          Object.getOwnPropertyDescriptor(this.originalClass, prop)!,
        );
      }
    }
  }
}
