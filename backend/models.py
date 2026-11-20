"""Request validation and mapping to the solver's configuration."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .dataset import FLEET_TYPES, dataset

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False, validate_default=True)


class Fleet(StrictModel):
    cargo_bike: int = Field(8, ge=0, le=8)
    electric_van: int = Field(8, ge=0, le=8)
    diesel_van: int = Field(8, ge=0, le=8)


class ScenarioConfig(StrictModel):
    dates: list[str] = Field(min_length=1, max_length=45)
    scope: Literal["participating", "all"] = "participating"
    hub: str = "COM018"
    max_shift_h: float = Field(8, ge=4, le=14)
    cargo_max_km: float = Field(40, ge=1, le=150)
    pickup_service_min: float = Field(2, ge=0, le=10, multiple_of=0.5)
    travel_buffer_pct: int = Field(15, ge=0, le=100)
    w_eur: float = Field(1, ge=0, le=100)
    w_co2: float = Field(1, ge=0, le=100)
    priority_hard: bool = True
    fleet: Fleet = Field(default_factory=Fleet)
    time_limit: int = Field(15, ge=1, le=120)

    @model_validator(mode="after")
    def check_source(self):
        data = dataset()
        if len(set(self.dates)) != len(self.dates) or set(self.dates) - set(data.dates):
            raise ValueError("Choose unique dates that exist in the Hedyla dataset.")
        if self.hub not in data.shops:
            raise ValueError("Choose a hub at a shop node in the Hedyla matrix.")
        if not (self.w_eur or self.w_co2):
            raise ValueError("At least one objective weight must be positive.")
        fleet = self.fleet.model_dump()
        if not sum(fleet.values()) or any(qty > data.fleet[kind] for kind, qty in fleet.items()):
            raise ValueError("Select at least one vehicle and stay within source fleet quantities.")
        return self

    def solver_config(self, data):
        quantities = self.fleet.model_dump()
        vehicle_ids = []
        for kind in FLEET_TYPES:
            ids = [v["vehicle_id"] for v in data.vehicles if v["type"] == kind]
            vehicle_ids.extend(ids[:quantities[kind]])
        values = self.model_dump(exclude={"dates", "scope", "hub", "travel_buffer_pct", "fleet"})
        strategy = "LOCAL_CHEAPEST_INSERTION" if self.scope == "all" else "LOCAL_CHEAPEST_COST_INSERTION"
        return dict(values, data=data.dir, depot=self.hub, all_shops=self.scope == "all",
                    travel_buffer=1 + self.travel_buffer_pct / 100, vehicle_ids=vehicle_ids,
                    day_start="08:00", day_end="22:00", priority_weight=1,
                    timing="departure_phase_worst_case", first_solution_strategy=strategy)


class SaveScenario(StrictModel):
    name: Name
    config: ScenarioConfig


class RunRequest(SaveScenario):
    pass


class RenameScenario(StrictModel):
    name: Name


class DuplicateScenario(StrictModel):
    name: Name | None = None


class StressRequest(StrictModel):
    date: str
    traffic_pct: Literal[0, 10, 15, 25] = 0
    pickup_service_min: Literal[0, 2, 5] | None = None
    max_shift_h: Literal[8, 10] | None = None
    cargo_max_km: Literal[30, 40, 50] | None = None
