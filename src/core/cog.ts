import * as grpc from '@grpc/grpc-js';
import { Struct, Value } from 'google-protobuf/google/protobuf/struct_pb';
import * as fs from 'fs';
import { Field, StepInterface } from './base-step';
import { ClientWrapper } from '../client/client-wrapper';
import { ICogServiceServer } from '../proto/cog_grpc_pb';
import { ManifestRequest, CogManifest, Step, RunStepRequest, RunStepResponse, FieldDefinition, StepDefinition, StepRecord, TableRecord } from '../proto/cog_pb';
import { AzureBlob } from '../log/azure-blob';
import { AzureBlobContainer } from '../log/azure-blob-container';

export class Cog implements ICogServiceServer {
  private steps: StepInterface[];
  private blobContainer: AzureBlobContainer = new AzureBlobContainer("gemini-cog-logs")

  constructor(private clientWrapperClass, private stepMap: Record<string, any> = {}) {
    // Dynamically reads the contents of the ./steps folder for step definitions and makes the
    // corresponding step classes available on this.steps and this.stepMap.
    // tslint:disable-next-line:max-line-length
    this.steps = [].concat(...Object.values(this.getSteps(`${__dirname}/../steps`, clientWrapperClass)));
  }

  private getSteps(dir: string, clientWrapperClass) {
    const steps = fs.readdirSync(dir, { withFileTypes: true })
    .map((file: fs.Dirent) => {
      if (file.isFile() && (file.name.endsWith('.ts') || file.name.endsWith('.js'))) {
        const step = require(`${dir}/${file.name}`).Step;
        const stepInstance: StepInterface = new step(clientWrapperClass);
        this.stepMap[stepInstance.getId()] = step;
        return stepInstance;
      } if (file.isDirectory()) {
        return this.getSteps(`${__dirname}/../steps/${file.name}`, clientWrapperClass);
      }
    });

    // Note: this filters out files that do not match the above (e.g. READMEs
    // or .js.map files in built folder, etc).
    return steps.filter(s => s !== undefined);
  }

  /**
   * Implements the cog:getManifest grpc method, responding with a manifest definition, including
   * details like the name of the cog, the version of the cog, any definitions for required
   * authentication fields, and step definitions.
   */
  getManifest(
    call: grpc.ServerUnaryCall<ManifestRequest, CogManifest>,
    callback: grpc.sendUnaryData<CogManifest>,
  ) {
    const manifest: CogManifest = new CogManifest();
    const pkgJson: Record<string, any> = JSON.parse(
      fs.readFileSync('package.json').toString('utf8'),
    );
    const stepDefinitions: StepDefinition[] = this.steps.map((step: StepInterface) => {
      return step.getDefinition();
    });
    manifest.setName(pkgJson.cog.name);
    manifest.setLabel(pkgJson.cog.label);
    manifest.setVersion(pkgJson.version);
    if (pkgJson.cog.homepage) {
      manifest.setHomepage(pkgJson.cog.homepage);
    }
    if (pkgJson.cog.authHelpUrl) {
      manifest.setAuthHelpUrl(pkgJson.cog.authHelpUrl);
    }

    manifest.setStepDefinitionsList(stepDefinitions);

    ClientWrapper.expectedAuthFields.forEach((field: Field) => {
      const authField: FieldDefinition = new FieldDefinition();
      authField.setKey(field.field);
      authField.setOptionality(FieldDefinition.Optionality.REQUIRED);
      authField.setType(field.type);
      authField.setDescription(field.description);
      if (field.help) {
        authField.setHelp(field.help);
      }
      manifest.addAuthFields(authField);
    });

    callback(null, manifest);
  }

  /**
   * Implements the cog:runSteps grpc method, responding to a stream of RunStepRequests and
   * responding in kind with a stream of RunStepResponses. This method makes no guarantee that the
   * order of step responses sent corresponds at all with the order of step requests received.
   */
  runSteps(call: grpc.ServerDuplexStream<RunStepRequest, RunStepResponse>) {
    // Instantiate a single client for all step requests.
    const client = this.instantiateClient(call.metadata);
    let processing = 0;
    let clientEnded = false;

    call.on('data', async (runStepRequest: RunStepRequest) => {
      processing = processing + 1;

      const step: Step = runStepRequest.getStep();
      const response: RunStepResponse = await this.dispatchStep(step, call.metadata, client);

      call.write(response);
      this.exportToAzureBlobStorage(response);
      processing = processing - 1;

      // If this was the last step to process and the client has ended the stream, then end our
      // stream as well.
      if (processing === 0 && clientEnded) {
        // await this.exportToAzureBlobStorage(blobContent);
        call.end();
      }
    });

    call.on('end', () => {
      clientEnded = true;

      // Only end the stream if we are done processing all steps.
      if (processing === 0) {
        call.end();
      }
    });
  }

  /**
   * Implements the cog:runStep grpc method, responding to a single RunStepRequest with a single
   * RunStepResponse.
   */
  async runStep(
    call: grpc.ServerUnaryCall<RunStepRequest, CogManifest>,
    callback: grpc.sendUnaryData<RunStepResponse>,
  ) {
    const step: Step = call.request.getStep();
    const response: RunStepResponse = await this.dispatchStep(step, call.metadata);

    this.exportToAzureBlobStorage(response);

    callback(null, response);
  }

  /**
   * Helper method to dispatch a given step to its corresponding step class and handle error
   * scenarios. Always resolves to a RunStepResponse, regardless of any underlying errors.
   */
  private async dispatchStep(
    step: Step,
    metadata: grpc.Metadata,
    clientWrapper: ClientWrapper = null,
  ): Promise<RunStepResponse> {
    // Use the provided client wrapper if given, or instantiate a new one.
    const client = clientWrapper || this.instantiateClient(metadata);
    const stepId = step.getStepId();
    let response: RunStepResponse = new RunStepResponse();

    if (!this.stepMap.hasOwnProperty(stepId)) {
      response.setOutcome(RunStepResponse.Outcome.ERROR);
      response.setMessageFormat('Unknown step %s');
      response.addMessageArgs(Value.fromJavaScript(stepId));
      return response;
    }

    try {
      const stepExecutor: StepInterface = new this.stepMap[stepId](client);
      response = await stepExecutor.executeStep(step);
    } catch (e) {
      response.setOutcome(RunStepResponse.Outcome.ERROR);
      response.setResponseData(Struct.fromJavaScript(e));
    }

    return response;
  }

  /**
   * Helper method to instantiate an API client wrapper for this Cog.
   */
  private instantiateClient(auth: grpc.Metadata): ClientWrapper {
    return new this.clientWrapperClass(auth);
  }

  private exportToAzureBlobStorage(response: RunStepResponse) {

    let blobContent = {
      outcome: response.getOutcome(),
      message: response.getMessageFormat()
    };

    const records = response.getRecordsList();

    records.forEach(record => {
      if (record.getValueCase() === StepRecord.ValueCase.KEY_VALUE) {
        const keyValue = (record.getKeyValue() || new Struct()).toJavaScript()
        const keys = Object.keys(keyValue)
        keys.forEach(key => {
          blobContent[key] = keyValue[key]
        })
      }
      
      if (record.getValueCase() === StepRecord.ValueCase.TABLE) { 
        const table = record.getTable() || new TableRecord()
          const tableHeaders = (table.getHeaders() || new Struct()).toJavaScript()
          const rows = table.getRowsList().map(row => row.toJavaScript())
          Object.keys(tableHeaders).forEach(header => {
            blobContent[header] = rows.map(row => row[header])
          })
        }
    })

    const blob = new AzureBlob(blobContent);
    this.blobContainer.uploadBlob(blob);
  }
}
