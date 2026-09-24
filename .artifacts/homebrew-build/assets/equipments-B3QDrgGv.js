const r=`base silahlar armorlar falan\r
\r
\r
\r
\r
## Armor\r
\r
<table class="tableRow">\r
        <caption>Armor Tablosu</caption>\r
        <tbody>\r
            <tr>\r
                <th>Armor Type</th>\r
                <th>Description</th>\r
                <th>AC</th>\r
            </tr>\r
            <tr>\r
                <td>Light Armor</td>\r
                <td>Bu armor çeşidini giyerken AC'ni geçemeyen saldırıları Dodge'larsın (0 hasar).</td>\r
                <td>Base(10) + DEX Mod + (Armordan gelen bonus(En düşük bonus light armorlardan gelir))</td>\r
            </tr>\r
            <tr>\r
                <td>Medium Armor</td>\r
                <td>Bu armor çeşidini giyerken AC'ni geçemeyen saldırıları Block'larsın (yarı hasar).</td>\r
                <td>Base(10) + ((DEX Mod + STR Mod) * 2/3) + (Armordan gelen bonus)</td>\r
            </tr>\r
            <tr>\r
                <td>Heavy Armor</td>\r
                <td>Bu armor çeşidini giyerken AC'ni geçemeyen saldırıları Block'larsın (yarı hasar).</td>\r
                <td>Base(10) + STR Mod + (Armordan gelen bonus)</td>\r
            </tr>\r
            <tr>\r
                <td>Natural Armor</td>\r
                <td>Bazı ırkların derileri sağlam olduğu için zırh giymek yerine Natural Armor kullanabilirler. Bu karakterler Dodge ve Block AC arasında seçim yapabilir.</td>\r
                <td>Dodge: Base(10) + DEX Mod <br> Block: Base(10) + STR Mod + (Deriden gelen bonus)</td>\r
            </tr>\r
            <tr>\r
                <td>Unarmored (Block)</td>\r
                <td>Bazı class veya feat'ler armorun yokken bunu kullanmana izin verebilir. Örneğin Barbarian'lar.</td>\r
                <td>Base(10) + STR Mod + CON Mod</td>\r
            </tr>\r
            <tr>\r
                <td>Unarmored (Dodge)</td>\r
                <td>Bazı class veya feat'ler armorun yokken bunu kullanmana izin verebilir. Örneğin Monk'lar.</td>\r
                <td>Base(10) + DEX Mod + WIS Mod</td>\r
            </tr>\r
            <tr>\r
                <td>Shield</td>\r
                <td>AC değerini arttırır.</td>\r
                <td>+AC</td>\r
            </tr>\r
        </tbody>\r
</table>\r
\r
\r
\r
\r
\r
\r
## Weapon\r
\r
<table class="tableRow">\r
        <caption>Weapon Properties</caption>\r
        <tbody>\r
            <tr>\r
                <th>Property</th>\r
                <th>Description</th>\r
            </tr>\r
            <tr>\r
                <td>Heavy</td>\r
                <td>Medium'dan küçük karakterler dezavantajlı kullanır.</td>\r
            </tr>\r
            <tr>\r
                <td>Light</td>\r
                <td>Çift silah kuşanıp, ikili saldırı yapabilmeyi sağlar.</td>\r
            </tr>\r
            <tr>\r
                <td>Thrown</td>\r
                <td>Silah fırlatılabilir.</td>\r
            </tr>\r
            <tr>\r
                <td>Two-Handed</td>\r
                <td>Silah iki elle kullanılır.</td>\r
            </tr>\r
            <tr>\r
                <td>Versatile</td>\r
                <td>Silah hem tek hem iki elli kullanılabilir. İki elli kullanırken hasar zarı iki kere atılır.</td>\r
            </tr>\r
            <tr>\r
                <td>Ammo</td>\r
                <td>Bu silah bir çeşit mermi türü gerektirir.</td>\r
            </tr>\r
            <tr>\r
                <td>Loading</td>\r
                <td>Bu silah kullanılmaya hazır hale getirilmek için bir eylem gerektirir.</td>\r
            </tr>\r
            <tr>\r
                <td>Reach</td>\r
                <td>Uzağa erişebilir.</td>\r
            </tr>\r
            <tr>\r
                <td>Silvered</td>\r
                <td>Gümüş katılarak doğa üstü canlılara otomatik kritik atar.</td>\r
            </tr>\r
        </tbody>\r
</table>\r
\r
<table class="tableRow">\r
        <caption>Silah Tablosu</caption>\r
        <tbody>\r
            <tr>\r
                <th colspan="4">Simple Weapons</th>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Simple Melee Weapons</th>\r
            </tr>\r
            <tr>\r
                <th>Weapon</th>\r
                <th>Ability</th>\r
                <th>Damage</th>\r
                <th>Properties</th>\r
            </tr>\r
            <tr>\r
                <td>Club</td>\r
                <td>STR</td>\r
                <td>d4 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>Light</td>\r
            </tr>\r
            <tr>\r
                <td>Greatclub</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>Two-Handed</td>\r
            </tr>\r
            <tr>\r
                <td>Light Hammer</td>\r
                <td>STR</td>\r
                <td>d4 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>Light, Thrown</td>\r
            </tr>\r
            <tr>\r
                <td>Mace</td>\r
                <td>STR</td>\r
                <td>d6 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>-</td>\r
            </tr>\r
            <tr>\r
                <td>Quarterstaff</td>\r
                <td>STR</td>\r
                <td>d6 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>d8 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Javelin</td>\r
                <td>STR</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Thrown</td>\r
            </tr>\r
            <tr>\r
                <td>Spear</td>\r
                <td>DEX</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Thrown, d8 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Dagger</td>\r
                <td>DEX</td>\r
                <td>d4 1d10 + 10 + MOD, Piercing</td>\r
                <td>Light, Thrown</td>\r
            </tr>\r
            <tr>\r
                <td>Sickle</td>\r
                <td>STR</td>\r
                <td>d4 1d10 + 10 + MOD, Slashing</td>\r
                <td>Light</td>\r
            </tr>\r
            <tr>\r
                <td>Handaxe</td>\r
                <td>STR</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Light, Thrown</td>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Simple Ranged Weapons</th>\r
            </tr>\r
            <tr>\r
                <td>Sling</td>\r
                <td>DEX</td>\r
                <td>d4 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>Ammo</td>\r
            </tr>\r
            <tr>\r
                <td>Dart</td>\r
                <td>DEX</td>\r
                <td>d4 1d10 + 10 + MOD, Piercing</td>\r
                <td>Thrown</td>\r
            </tr>\r
            <tr>\r
                <td>Shortbow</td>\r
                <td>DEX</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Ammo, Two-Handed</td>\r
            </tr>\r
            <tr>\r
                <td>Light Crossbow</td>\r
                <td>DEX</td>\r
                <td>d8 1d10 + 10 + MOD, Piercing</td>\r
                <td>Ammo, Two-Handed, Loading</td>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Martial Weapons</th>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Martial Melee Weapons</th>\r
            </tr>\r
            <tr>\r
                <td>Warhammer</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>d10 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Flail</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>-</td>\r
            </tr>\r
            <tr>\r
                <td>Maul</td>\r
                <td>STR</td>\r
                <td>2d6 1d10 + 10 + MOD, Bludgeoning</td>\r
                <td>Two-Handed, Heavy</td>\r
            </tr>\r
            <tr>\r
                <td>Trident</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Piercing</td>\r
                <td>Thrown, d10 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Shortsword</td>\r
                <td>STR / DEX</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Light</td>\r
            </tr>\r
            <tr>\r
                <td>Rapier</td>\r
                <td>DEX</td>\r
                <td>d8 1d10 + 10 + MOD, Piercing</td>\r
                <td>-</td>\r
            </tr>\r
            <tr>\r
                <td>Lance</td>\r
                <td>STR</td>\r
                <td>d10 1d10 + 10 + MOD, Piercing</td>\r
                <td>Heavy, Two-Handed, Reach</td>\r
            </tr>\r
            <tr>\r
                <td>Morningstar</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Piercing</td>\r
                <td>-</td>\r
            </tr>\r
            <tr>\r
                <td>*Orak*</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Piercing</td>\r
                <td>d10 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Glaive</td>\r
                <td>STR</td>\r
                <td>d10 1d10 + 10 + MOD, Slashing</td>\r
                <td>Two-Handed, Heavy, Reach</td>\r
            </tr>\r
            <tr>\r
                <td>Scimitar</td>\r
                <td>DEX</td>\r
                <td>d6 1d10 + 10 + MOD, Slashing</td>\r
                <td>Light</td>\r
            </tr>\r
            <tr>\r
                <td>Battleaxe</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Slashing</td>\r
                <td>d10 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Greataxe</td>\r
                <td>STR</td>\r
                <td>d12 1d10 + 10 + MOD, Slashing</td>\r
                <td>Two-Handed, Heavy</td>\r
            </tr>\r
            <tr>\r
                <td>Longsword</td>\r
                <td>STR</td>\r
                <td>d8 1d10 + 10 + MOD, Slashing</td>\r
                <td>d10 Versatile</td>\r
            </tr>\r
            <tr>\r
                <td>Greatsword</td>\r
                <td>STR</td>\r
                <td>2d6 1d10 + 10 + MOD, Slashing</td>\r
                <td>Two-Handed, Heavy</td>\r
            </tr>\r
            <tr>\r
                <td>Whip</td>\r
                <td>DEX</td>\r
                <td>d4 1d10 + 10 + MOD, Slashing</td>\r
                <td>Reach</td>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Martial Ranged Weapons</th>\r
            </tr>\r
            <tr>\r
                <td>Hand Crossbow</td>\r
                <td>DEX</td>\r
                <td>d6 1d10 + 10 + MOD, Piercing</td>\r
                <td>Light, Ammo, Loading</td>\r
            </tr>\r
            <tr>\r
                <td>Heavy Crossbow</td>\r
                <td>DEX</td>\r
                <td>d10 1d10 + 10 + MOD, Piercing</td>\r
                <td>Two-Handed, Heavy, Loading, Ammo</td>\r
            </tr>\r
            <tr>\r
                <td>Longbow</td>\r
                <td>STR / DEX</td>\r
                <td>d8 1d10 + 10 + MOD, Slashing</td>\r
                <td>Two-Handed, Heavy, Ammo</td>\r
            </tr>\r
            <tr>\r
                <td>Blowgun</td>\r
                <td>DEX</td>\r
                <td>d? 1d10 + 10 + MOD, Slashing</td>\r
                <td>Ammo, Load</td>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Firearm Weapons</th>\r
            </tr>\r
            <tr>\r
                <th>Weapon Type</th>\r
                <th>Range</th>\r
                <th>Damage</th>\r
                <th>Fire Rate</th>\r
            </tr>\r
            <tr>\r
                <td>Light Ammo</td>\r
                <td>Short</td>\r
                <td>Low</td>\r
                <td>Fast</td>\r
            </tr>\r
            <tr>\r
                <td>Medium Ammo</td>\r
                <td>Short</td>\r
                <td>High</td>\r
                <td>Medium</td>\r
            </tr>\r
            <tr>\r
                <td>Long Ammo</td>\r
                <td>Long</td>\r
                <td>High</td>\r
                <td>Slow</td>\r
            </tr>\r
            <tr>\r
                <td>Shotgun Ammo</td>\r
                <td>Very Short</td>\r
                <td>Very High</td>\r
                <td>Slow</td>\r
            </tr>\r
            <tr>\r
                <th colspan="4">Magic Weapons</th>\r
            </tr>\r
            <tr>\r
                <td>Magic Wand</td>\r
                <td>INT / WIS / CHA</td>\r
                <td>d6 1d10 + 10 + MOD, Slashing</td>\r
                <td>Light</td>\r
            </tr>\r
            <tr>\r
                <td>Magic Staff</td>\r
                <td>INT / WIS / CHA</td>\r
                <td>d10 1d10 + 10 + MOD, Slashing</td>\r
                <td>Two-Handed</td>\r
            </tr>\r
            <tr>\r
                <td>Magic Grimoire</td>\r
                <td>INT / WIS / CHA</td>\r
                <td>d? 1d10 + 10 + MOD, Slashing</td>\r
                <td>Light</td>\r
            </tr>\r
        </tbody>\r
</table>\r
\r
\r
\r
## Other Equipments\r
\r
ring, scroll, amulet, helmet, glove, leggings, boots, consumables\r
\r
\r
\r
\r
\r
## Tools\r
\r
Artisans\r
\r
Alchemist's Supplies: INT\r
Bir substance identify'lanabilir (DC 15) veya craft yapılabilir\r
\r
Brewer's Supplies: INT\r
Alköl (DC 10) veya zehir (DC 15) detect\r
\r
Calligrapher's Supplies: DEX\r
Forgery yapma yada döküman hazırlama VE spell scroll craftlama\r
\r
Carpenter's Tools: STR\r
Odunculuk ile ilgili craftlar\r
\r
Cartographer's Tools: WIS\r
Map craftlama\r
\r
Cobbler's Tools: DEX\r
???\r
\r
Cook's Utensils: WIS\r
Zehirli yada bozulmuş yemek detectle, yemek craftla\r
\r
Glassblower's Tools: INT\r
Cam objenin içinde en son ne varmış onu anlarsın. Camlı craftlar.\r
\r
Jeweler's Tools: INT\r
Değerli eşyaların ederini anlarsın, holy symbol craft?\r
\r
Leatherworker's Tools: DEX\r
Dericilik ile ilgili craftlar\r
\r
Mason's Tools: STR\r
Chiseling ile ilgili şeyler\r
\r
Painter's Supplies: WIS\r
Çizerlik ile ilgili şeyler\r
\r
Potter's Tools: INT\r
Seramik objenin içinde en son ne varmış onu anlarsın. Seramik craftlar.\r
\r
Smith's Tools: STR\r
Demircilik ile ilgili craftlar\r
\r
Tinker's Tools: DEX\r
Silah, tuzak, kilit, kürek, ayna, whistle gibi şeyler craftlar\r
\r
Weaver's Tools: DEX\r
Kıyafet repair ve craft\r
\r
\r
Gaming Sets: WIS\r
Birinin hile yapıp yapmadığını anlama (DC 10), kazanma (20)\r
Dice, Kart, Chess vs.\r
Hile yapmak ise sleight of hand ile yapılır.\r
\r
Musical Instrument: CHA\r
Tune çal (DC 10), performans yap (DC 15)\r
\r
\r
Disguise Kit: CHA\r
Kostüm, makyaj vs\r
\r
Forgery Kit: DEX\r
Yazı klonla (DC 15), mühür klonla (DC 20)\r
\r
Herbalism Kit: INT\r
Bitki identify'la, healing potion gibi craftlar yapabilir\r
\r
Navigator's Tools: WIS\r
Rota belirle (DC 10), pozisyon hesapla (DC 15)\r
\r
Poisoner's Kit: INT\r
Poison detect (DC 10)\r
\r
Thieves' Tools: DEX\r
Pick a lock (DC 15), disarm trap (DC 15)\r
`;export{r as default};
