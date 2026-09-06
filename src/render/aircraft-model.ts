/**
 * The player's aircraft as a Cesium `Model` primitive whose matrix is set
 * directly from the simulation every frame. (An `Entity` would be updated by
 * the viewer before the simulation runs and lag the camera by a frame.)
 */
import { Cartesian3, Matrix4, Model, type Viewer } from 'cesium';
import type { ModelConfig } from '../aircraft/aircraft-type';
import type { AircraftState } from '../sim/physics';
import { aircraftPosition, enuFrame, modelMatrix } from './frames';

export class OwnAircraft {
  private model: Model | null = null;
  private show = true;
  private readonly position = new Cartesian3();
  private readonly frame = new Matrix4();
  private readonly matrix = Matrix4.clone(Matrix4.IDENTITY);

  constructor(
    private readonly viewer: Viewer,
    config: ModelConfig,
  ) {
    const url = `${import.meta.env.BASE_URL}${config.uri}`;
    Model.fromGltfAsync({ url, scale: config.scale, modelMatrix: this.matrix })
      .then((model) => {
        this.model = model;
        model.show = this.show;
        model.modelMatrix = Matrix4.clone(this.matrix, model.modelMatrix);
        viewer.scene.primitives.add(model);
      })
      .catch((error: unknown) => {
        console.warn(`[airium] could not load the aircraft model ${url}`, error);
      });
  }

  update(state: AircraftState): void {
    aircraftPosition(state, this.position);
    enuFrame(this.position, this.frame);
    modelMatrix(this.frame, state.attitude, this.matrix);
    if (this.model) {
      this.model.modelMatrix = Matrix4.clone(this.matrix, this.model.modelMatrix);
    }
  }

  set visible(show: boolean) {
    this.show = show;
    if (this.model) this.model.show = show;
  }

  get visible(): boolean {
    return this.show;
  }

  destroy(): void {
    if (this.model) this.viewer.scene.primitives.remove(this.model);
    this.model = null;
  }
}
