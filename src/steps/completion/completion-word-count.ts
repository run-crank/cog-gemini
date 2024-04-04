/* tslint:disable:no-else-after-return */

import * as util from '@run-crank/utilities';
import {
  BaseStep, Field, StepInterface, ExpectedRecord,
} from '../../core/base-step';
import {
  Step, FieldDefinition, StepDefinition, RecordDefinition, StepRecord,
} from '../../proto/cog_pb';
import { baseOperators } from '../../client/constants/operators';

export class CompletionWordCount extends BaseStep implements StepInterface {
  protected stepName: string = 'Check Gemini prompt response word count from completion';

  // tslint:disable-next-line:max-line-length quotemark
  protected stepExpression: string = `Gemini model (?<model>[a-zA-Z0-9_ -.]+) word count in a response to "(?<prompt>[a-zA-Z0-9_ -'".,?!]+)" should (?<operator>be set|not be set|be less than|be greater than|be one of|be|contain|not be one of|not be|not contain|match|not match) ?(?<expectation>.+)?`;

  protected stepType: StepDefinition.Type = StepDefinition.Type.VALIDATION;

  protected actionList: string[] = ['check'];

  protected targetObject: string = 'Completion';

  protected expectedFields: Field[] = [{
    field: 'prompt',
    type: FieldDefinition.Type.STRING,
    description: 'User Prompt to send to GPT',
  }, {
    field: 'model',
    type: FieldDefinition.Type.STRING,
    description: 'GPT Model to use for completion',
  }, {
    field: 'operator',
    type: FieldDefinition.Type.STRING,
    optionality: FieldDefinition.Optionality.OPTIONAL,
    description: 'Check Logic (be, not be, be greater than, be less than, be set, not be set, be one of, or not be one of)',
  },
  {
    field: 'expectation',
    type: FieldDefinition.Type.NUMERIC,
    description: 'Expected GPT word count',
    optionality: FieldDefinition.Optionality.OPTIONAL,
  }];

  protected expectedRecords: ExpectedRecord[] = [{
    id: 'completion',
    type: RecordDefinition.Type.KEYVALUE,
    fields: [{
      field: 'model',
      type: FieldDefinition.Type.STRING,
      description: 'Completion Model',
    }, {
      field: 'prompt',
      type: FieldDefinition.Type.STRING,
      description: 'Completion Prompt',
    }, {
      field: 'response',
      type: FieldDefinition.Type.STRING,
      description: 'Completion Model Response',
    }, {
      field: 'word count',
      type: FieldDefinition.Type.NUMERIC,
      description: 'Completion Word Count',
    }, {
      field: 'usage',
      type: FieldDefinition.Type.STRING,
      description: 'Completion Usage',
    }, {
      field: 'created',
      type: FieldDefinition.Type.NUMERIC,
      description: 'Completion Create Date',
    }],
    dynamicFields: true,
  }];

  static getWordCount(text: string): number {
    return text.split(' ').length;
  }

  async executeStep(step: Step) {
    const stepData: any = step.getData() ? step.getData().toJavaScript() : {};
    const { expectation } = stepData;
    const { prompt } = stepData;
    const { model } = stepData;
    const operator = stepData.operator || 'be';

    try {
      const message = prompt;
      const completion = await this.client.getChatCompletion(model, message);
      const response = completion.text_response;
      const actual = CompletionWordCount.getWordCount(response);
      const result = this.assert(operator, actual.toString(), expectation.toString(), 'response');
      const returnObj = {
        model,
        prompt,
        response,
        wordcount: actual,
        usage: completion.usage,
        request: completion.request_payload,
      };
      const records = this.createRecords(returnObj, stepData.__stepOrder);
      return result.valid ? this.pass(result.message, [], records) : this.fail(result.message, [], records);
    } catch (e) {
      if (e instanceof util.UnknownOperatorError) {
        return this.error('%s Please provide one of: %s', [e.message, baseOperators.join(', ')]);
      }
      if (e instanceof util.InvalidOperandError) {
        return this.error('There was an error checking Gemini chat completion object: %s', [e.message]);
      }

      return this.error('There was an error checking  Gemini chat completion object: %s', [e.toString()]);
    }
  }

  public createRecords(completion, stepOrder = 1): StepRecord[] {
    const records = [];
    // Base Record
    records.push(this.keyValue('completion', 'Checked Word Count', completion));
    // Ordered Record
    records.push(this.keyValue(`completion.${stepOrder}`, `Checked Word Count from Step ${stepOrder}`, completion));
    return records;
  }
}

export { CompletionWordCount as Step };
