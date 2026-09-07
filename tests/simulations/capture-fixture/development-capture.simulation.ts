import { Application } from "../../../src/application.ts";
import { loadApplicationConfiguration } from "../../../src/application.configuration.ts";
import { DEVELOPMENT_CAPTURE_INPUTS } from "./development-capture.inputs.ts";

export async function runDevelopmentCaptureSimulation(): Promise<void> {
  const configuration = await loadApplicationConfiguration();
  const application = await Application.create(configuration);

  try {
    // For a new native event, add an item with a new itemIndex. Changing an
    // existing event at the same replay coordinates can cause a replay conflict.
    const receipts = await application.capture({
      sourceKey: "development.fixture",
      nativeInputs: DEVELOPMENT_CAPTURE_INPUTS,
    });

    console.log("Durable capture receipts:");
    console.log(JSON.stringify(receipts, null, 2));
  } finally {
    await application.close();
  }
}
