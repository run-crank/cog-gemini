import { EnhancedGenerateContentResponse, CountTokensResponse } from "@google/generative-ai";

export class ClientResponseWrapper {
  private originalClass: EnhancedGenerateContentResponse;

  public response_time: number;

  public request_payload: object;

  public text_response: string;

  public usage: any;

  constructor(originalClass: EnhancedGenerateContentResponse, responseTime: number, requestPrompt: string, tokenUsage: CountTokensResponse) {
    this.originalClass = originalClass;
    this.copyProperties();
    this.response_time = responseTime;
    this.request_payload = {'prompt': requestPrompt};
    this.text_response = originalClass.text();
    this.usage = {
      //TODO: countToken API didn't specify the input/output token
      total: tokenUsage.totalTokens,
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
