# Pokemon Obsidian Vault

In `/gen` folder, there are a series of Pokemon data, which could be used well participate with Obsidian and Obsidian plugins such as `dataview` and `chartjs` .

## Example

### auto complete

Use Obsidian alias feature for quick reference and auto complete:
[[9_steel|はがね]] [[95_onix|大岩蛇]]

### dataview

With data view code block:

````
```dataview
table zh_name, jp_name, types, stats.attack as attack
from "gen/pokemon" and [[424_fire-fang|move/fire-fang]]
where contains(types, "rock")
where stats.attack > 100
sort id asc
limit 10
```
````

Would Render:

```dataview
table zh_name, jp_name, types, stats.attack as attack
from "gen/pokemon" and [[424_fire-fang|move/fire-fang]]
where contains(types, "rock")
where stats.attack > 100
sort id asc
limit 10
```


Clone this branch and open with Obsidian for rendering result.

```sh
git clone --branch vault https://github.com/RyoJerryYu/pokemon-vault.git
```
