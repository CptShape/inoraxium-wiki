const r=`## Sorcerer\r
\r
<table class="tableRow">\r
    <caption>Sorcerer</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="2">Pasif Yetenekler</th>\r
    </tr>\r
    <tr>\r
        <th>Özellik</th>\r
        <th>Açıklama</th>\r
    </tr>\r
    <tr>\r
        <td>Source Within</td>\r
        <td>Büyü kaynağından içinden geldiği için bir magic school seç ve onda Expertise al.</td>\r
    </tr>\r
    <tr>\r
        <td>Metamagic</td>\r
        <td>Yaptığın büyülere ekstra <a href="#metamagic">özellikler</a> ekleyebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td>Innate Sorcery</td>\r
        <td>Tanık olduğun bir büyüyü taklit etmeyi VEYA Mastery'e sahip olduğun bir büyü kategorisinde var olmayan bir büyü üretmeyi deneyebilirsin. Büyünün level'ına göre o DC'si o kadar yüksek olur. Her başarılı olduğunda DC'si giderek düşer. Aynı anda Innate Sorcery ile öğrenmeye çalıştığı büyü sayısı sınırlıdır. DC'sini 10'a düşürmeyi başardığın zaman kalıcı olarak büyüler listene eklenir.</td>\r
    </tr>\r
    <tr>\r
        <th colspan="2">Sorcery Tipin</th>\r
    </tr>\r
    <tr>\r
        <td>Conduit</td>\r
        <td>Source Within'den bir yerine 3 tane kategoride mastery seçebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td>Mindfract</td>\r
        <td>Innate Sorcery ile aynı anda öğrenmeye çalıştığı büyü sayısı limiti artar.</td>\r
    </tr>\r
    <tr>\r
        <td>Overchanneler</td>\r
        <td>Metamagic ile büyü buff'larken bir yerine 3 taneye kadar ekleme yapabilirsin ve her zaman en fazla sourcery point harcayan eklemen free dir.</td>\r
    </tr>\r
    <tr>\r
        <td>Rotbound</td>\r
        <td>Sadece mana değil aynı zamanda <a href="#rot">rot</a> erişimin var.</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
\r
\r
### Metamagic\r
\r
<table class="tableRow">\r
    <caption>Metamagic Tablosu</caption>\r
    <tbody>\r
    <tr>\r
        <th>Metamagic</th>\r
        <th>Açıklama</th>\r
    </tr>\r
    <tr>\r
        <td>Careful</td>\r
        <td>???</td>\r
    </tr>\r
    <tr>\r
        <td>Distant</td>\r
        <td>Range'ini iki katına çıkarır.</td>\r
    </tr>\r
    <tr>\r
        <td>Empowered</td>\r
        <td>Hasarına +%50 verir.</td>\r
    </tr>\r
    <tr>\r
        <td>Extended</td>\r
        <td>Etki süresini iki katına çıkarır.</td>\r
    </tr>\r
    <tr>\r
        <td>Heightened</td>\r
        <td>Rakibin save zarına dezavantaj verir.</td>\r
    </tr>\r
    <tr>\r
        <td>Quickened</td>\r
        <td>Büyü 1 CombatAP daha az harcar (zaten 1 C.AP ise, 1 M.AP ye çevirebilirsin)</td>\r
    </tr>\r
    <tr>\r
        <td>Seeking</td>\r
        <td>Iskaladıktan sonra eklenerek reroll atabilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td>Subtle</td>\r
        <td>Büyüyü farkedilmeden atmana yarar.</td>\r
    </tr>\r
    <tr>\r
        <td>Twinned</td>\r
        <td>Ekstra bir hedef seçebilmeni sağlar.</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
\r
\r
### Rot\r
\r
<table class="tableRow">\r
    <caption>Metamagic Tablosu</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="2">Rot</th>\r
    </tr>\r
    <tr>\r
        <td colspan="2">Büyülerini mana yerine rot ile kullanmayı seçtiğin zaman istediğin kadar metamagic ekleyebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td colspan="2">Harcaman gereken sourcery point kadar rot artışı almayı seçebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td colspan="2">Her rot kullanarak yaptığın büyü sonucu bir rot stack alırsın.</td>\r
    </tr>\r
    <tr>\r
        <td colspan="2">Rot kullanarak yaptığın büyüler verdiği hasarın yanında rakibin manasını yok eder, mute atmış olur.</td>\r
    </tr>\r
    <tr>\r
        <td colspan="2">İki rot stackli kişi savaşırken yüksek rotlu kişi, rot farkı kadar zarlarına + alır.</td>\r
    </tr>\r
    <tr>\r
        <th>Rot Stack</th>\r
        <th>Açıklama</th>\r
    </tr>\r
    <tr>\r
        <td>1 - 9</td>\r
        <td>Her gün 2 rot azalır. Fiziksel olarak bedende minimal kararma/morarmalar oluşur.</td>\r
    </tr>\r
    <tr>\r
        <td>10 - 24</td>\r
        <td>Her gün 1 rot azalır. Cilt solması, kararma/morarmalar daha belirgin, CON Disadvantage, Rot zarlarına proficiency.</td>\r
    </tr>\r
    <tr>\r
        <td>25 - 49</td>\r
        <td>Günlük rot azalması kesilir. Rot hala başka yöntemlerle azaltılabilir. Mana erişimin kısıtlandı, mana kullanımın disadvantage'lı artık. Rot zarlarına expertise.</td>\r
    </tr>\r
    <tr>\r
        <td>50 - 79</td>\r
        <td>Ruhunun artık yarısı rot corrupted. Mana erişimin tamamen kesildi. Rot azaltma yöntemlerin çok sınırlandı.</td>\r
    </tr>\r
    <tr>\r
        <td>80 - 99</td>\r
        <td>Voidwoken'a benziyorsun ve düşüncelerin artık voidwoken gibi olmaya başladı, point of no return noktası.</td>\r
    </tr>\r
    <tr>\r
        <td>100</td>\r
        <td>Voidwoken dönüşümü tamamlandı.</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
\r
\r
## Wizard\r
\r
<table class="tableRow">\r
    <caption>Wizard</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="2">Pasif Yetenekler</th>\r
    </tr>\r
    <tr>\r
        <th>Özellik</th>\r
        <th>Açıklama</th>\r
    </tr>\r
    <tr>\r
        <td>Scholar</td>\r
        <td>Büyü akademisinden mezun oldun. Default olarak 4 tane magic school proficiency seçersin. İstersen okulda gördüğün dersleri <a href="#magic-academy">customise</a> ederek ekstra şeyler öğrenebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td>Ritual Adept</td>\r
        <td>Ritual yapmayı biliyorsun. Bazı büyüler ritual olarak kullanılabilir, cast süresi 1 saat civarı sürer ama etkisi 24 saat kalır.</td>\r
    </tr>\r
    <tr>\r
        <td>Magic Grimoire</td>\r
        <td>Büyüleri kitabından okuyarak yapabilirsin. Kitabına başka bir kitaptan büyü veya scroll'ları geçirebilirsin.</td>\r
    </tr>\r
    <tr>\r
        <td>Memory</td>\r
        <td>Grimoire'inde bulunan bazı büyüleri ezberleyebilirsin, bu onları kitaba bakmadan hızlıca kullanmanı sağlar (AP Cost düşer yada MovementAP ile atılır)</td>\r
    </tr>\r
    <tr>\r
        <th colspan="2">Öğrenci Tipin</th>\r
    </tr>\r
    <tr>\r
        <td>Mnemonic</td>\r
        <td>Aynı anda daha fazla büyüyü ezberleyebilir.</td>\r
    </tr>\r
    <tr>\r
        <td>Academic</td>\r
        <td>"Scholar" lıkta element ve büyü türü mastery'si seçerken daha fazla seçim yapabilir, customise da ekstra 4 seçmeli seçebilir.</td>\r
    </tr>\r
    <tr>\r
        <td>Bookworm</td>\r
        <td>Ritual ve Kitaptan bakarak yaptığı büyülerde advantage alır.</td>\r
    </tr>\r
    <tr>\r
        <td>Prodigy</td>\r
        <td>???</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
\r
### Magic Academy\r
\r
<table class="tableRow">\r
    <caption>Magic Academy Year 1</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="4">Mandatory</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>History of Magic</td>\r
        <td>Tarih, edebiyat, coğrafya karışımı.</td>\r
        <td>Lore Bilgisi</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Defence Against the Dark Arts</td>\r
        <td>Necromancy ve Rot'a karşı savunma. Witchcraft, Undead'lere karşı korunma.</td>\r
        <td>(3-5 tane korunma büyüsü)</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Magical Theory</td>\r
        <td>Magic Sınıfları, türleri ve teorileri işlenir.</td>\r
        <td>Yazılı büyüleri okuyup anlayıp yapabilme yeteneği.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Mortal Studies</td>\r
        <td>Normal okulda öğretilen şeylerde öğretilir.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Gym</td>\r
        <td>Büyülü sporlar temel olarak öğretilir ve fiziksel gelişim.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td></td>\r
        <td></td>\r
        <td></td>\r
        <td></td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
<table class="tableRow">\r
    <caption>Magic Academy Year 2</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="4">Mandatory</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>Magic Logic</td>\r
        <td>Magic'in matematiksel ve mantıksal kısmı. Büyü yapımı, artificier'lar falan için.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Defence Against the Dark Arts</td>\r
        <td>Necromancy ve Rot'a karşı savunma. Witchcraft, Undead'lere karşı korunma.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Magimins & Magical Properties</td>\r
        <td>Büyülü bitkilere ufak tanıtım, büyülü karışımlar yani magimin'lere ufak tanıtım, büyülü objelere ufak tanıtım.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 1</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 2</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <th colspan="4">Seçmeli</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>Hydrosophist</td>\r
        <td>Hydrosophist 'e temel giriş.</td>\r
        <td>Hydrosophist Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Geomancer</td>\r
        <td>Geomancer 'e temel giriş.</td>\r
        <td>Geomancer Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Thermokinesis</td>\r
        <td>Thermokinesis 'e temel giriş.</td>\r
        <td>Thermokinesis Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Aerotheurge</td>\r
        <td>Aerotheurge 'e temel giriş.</td>\r
        <td>Aerotheurge Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Vitamancy</td>\r
        <td>Vitamancy 'e temel giriş.</td>\r
        <td>Vitamancy Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Necromancy</td>\r
        <td>Necromancy 'e temel giriş.</td>\r
        <td>Necromancy Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Divine Magic</td>\r
        <td>Divine Magic 'e temel giriş.</td>\r
        <td>Divine Magic Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Spectromancy</td>\r
        <td>Spectromancy 'e temel giriş.</td>\r
        <td>Spectromancy Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Psionic</td>\r
        <td>Psionic 'e temel giriş.</td>\r
        <td>Psionic Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Polymorph</td>\r
        <td>Polymorph 'a temel giriş.</td>\r
        <td>Polymorph Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Warfare</td>\r
        <td>Warfare 'a temel giriş.</td>\r
        <td>Warfare Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Anti Mana: Rot</td>\r
        <td>Rot 'a temel giriş.</td>\r
        <td>Rot Proficiency</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Astronomy</td>\r
        <td>Constellation'lar, yıldızlar, dolunaylar gibi şeyler büyüyle ilgili olduğu için astronomi önemli.</td>\r
        <td>Lore Bilgisi, ???</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Magical Sports</td>\r
        <td>Büyülü sporlardan birinin takımına katılıp okulu temsil etme şansı.</td>\r
        <td>Spora bağlı yetenek proficiency ve sonuca bağlı ün.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Arithmancy</td>\r
        <td>Büyünün arkasında ki matematik ve mühendisliğe giriş.</td>\r
        <td>Büyü yapımı, büyülü eşya yapımı gibi şeylere giriş.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Herbology </td>\r
        <td>Bitkiler, mantarlar, doğa ilgili şeyler.</td>\r
        <td>Survival Proficiency ve bilgi.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Magical Creatures</td>\r
        <td>Büyülü hayvanların tanıtımı ve ilgilenilmesi.</td>\r
        <td>Animal Handling bonusu ve bilgi.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Music Arts</td>\r
        <td>Müzik eğitimi ve büyünün müzik ile ilişkileri.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Performance Arts</td>\r
        <td>Rol yapma ve şovmenliğin büyü ile ilişkileri.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Ancient Studies</td>\r
        <td>Antik büyüler ve bilgiler.</td>\r
        <td>Lore</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Mythology</td>\r
        <td>Mitik canlılar, tanrılar, biblical entity'ler öğretilir.</td>\r
        <td>Lore</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td></td>\r
        <td></td>\r
        <td></td>\r
        <td>-</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
<table class="tableRow">\r
    <caption>Magic Academy Year 3</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="4">Mandatory</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>??? İlkeleri</td>\r
        <td>Büyü gelişimini hızlandıran, çığır açan ??? ve onun ilkeleri.</td>\r
        <td>Lore ve Büyü yaratma mantığı</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Kariyer Planlama</td>\r
        <td>Büyücüler için akademi sonrası hayat seçenekleri tanıtılır. Lisans sistemi gibi şeyler anlatılır ve öğrenciler ne olmak istediklerine karar verir.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 3</td>\r
        <td>Büyülü bitkilere ufak tanıtım, büyülü karışımlar yani magimin'lere ufak tanıtım, büyülü objelere ufak tanıtım.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 4</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 5</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <th colspan="4">Seçmeli</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>Advanced Hydrosophist</td>\r
        <td>Hydrosophist 'e detaylı giriş.</td>\r
        <td>Hydrosophist Expertise</td>\r
        <td>Hydrosophist</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Geomancer</td>\r
        <td>Geomancer 'e detaylı giriş.</td>\r
        <td>Geomancer Expertise</td>\r
        <td>Geomancer</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Thermokinesis</td>\r
        <td>Thermokinesis 'e detaylı giriş.</td>\r
        <td>Thermokinesis Expertise</td>\r
        <td>Thermokinesis</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Aerotheurge</td>\r
        <td>Aerotheurge 'e detaylı giriş.</td>\r
        <td>Aerotheurge Expertise</td>\r
        <td>Aerotheurge</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Vitamancy</td>\r
        <td>Vitamancy 'e detaylı giriş.</td>\r
        <td>Vitamancy Expertise</td>\r
        <td>Vitamancy</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Necromancy</td>\r
        <td>Necromancy 'e detaylı giriş.</td>\r
        <td>Necromancy Expertise</td>\r
        <td>Necromancy</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Divine Magic</td>\r
        <td>Divine Magic 'e detaylı giriş.</td>\r
        <td>Divine Magic Expertise</td>\r
        <td>Divine Magic</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Spectromancy</td>\r
        <td>Spectromancy 'e detaylı giriş.</td>\r
        <td>Spectromancy Expertise</td>\r
        <td>Spectromancy</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Psionic</td>\r
        <td>Psionic 'e detaylı giriş.</td>\r
        <td>Psionic Expertise</td>\r
        <td>Psionic</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Polymorph</td>\r
        <td>Polymorph 'a detaylı giriş.</td>\r
        <td>Polymorph Expertise</td>\r
        <td>Polymorph</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Warfare</td>\r
        <td>Warfare 'a detaylı giriş.</td>\r
        <td>Warfare Expertise</td>\r
        <td>Warfare</td>\r
    </tr>\r
    <tr>\r
        <td>Anti Mana: Advanced Rot</td>\r
        <td>Rot 'a detaylı giriş.</td>\r
        <td>Rot Proficiency</td>\r
        <td>Anti Mana: Rot</td>\r
    </tr>\r
    <tr>\r
        <td>Druidic</td>\r
        <td>Druid dili ve kültürü.</td>\r
        <td>Druidic, Lore</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Magical Sports</td>\r
        <td>Büyülü sporlardan birinin takımına katılıp okulu temsil etme şansı.</td>\r
        <td>Spora bağlı yetenek proficiency ve sonuca bağlı ün.</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Advanced Arithmancy</td>\r
        <td>Büyünün arkasında ki matematik ve mühendislik detaylı.</td>\r
        <td>Büyü yapımı, büyülü eşya yapımı gibi şeyler.</td>\r
        <td>Arithmancy</td>\r
    </tr>\r
    <tr>\r
        <td>Potion Making</td>\r
        <td>İksir yapımı ve malzemeleri.</td>\r
        <td>İksir craftlama öğrenilir.</td>\r
        <td>Herbology</td>\r
    </tr>\r
    <tr>\r
        <td>Study of Ancient Runes</td>\r
        <td>Rune okuma ve yazma.</td>\r
        <td>Rune crafting öğrenilir.</td>\r
        <td>Ancient Studies</td>\r
    </tr>\r
    <tr>\r
        <td>Study on Faith and Oaths</td>\r
        <td>İnanç ve yemin öğretilir.</td>\r
        <td>Lore</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td></td>\r
        <td></td>\r
        <td></td>\r
        <td>-</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
<table class="tableRow">\r
    <caption>Magic Academy Year 4</caption>\r
    <tbody>\r
    <tr>\r
        <th colspan="4">Mandatory</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>Bitirme Projesi + Staj</td>\r
        <td>Yıl başı proje belirlenir ve başlanır. Yıl ortası tatilde staj yapılır. Yıl sonunda proje sunulur.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 6</td>\r
        <td>Büyücüler için akademi sonrası hayat seçenekleri tanıtılır. Lisans sistemi gibi şeyler anlatılır ve öğrenciler ne olmak istediklerine karar verir.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 7</td>\r
        <td>Büyülü bitkilere ufak tanıtım, büyülü karışımlar yani magimin'lere ufak tanıtım, büyülü objelere ufak tanıtım.</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 8</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <td>Seçmeli 9</td>\r
        <td>-</td>\r
        <td>-</td>\r
        <td>-</td>\r
    </tr>\r
    <tr>\r
        <th colspan="4">Seçmeli</th>\r
    </tr>\r
    <tr>\r
        <th>Ders</th>\r
        <th>Açıklama</th>\r
        <th>Bonus</th>\r
        <th>Gerekli Ders</th>\r
    </tr>\r
    <tr>\r
        <td>Becoming a Druid</td>\r
        <td>Druidlik öğretilir.</td>\r
        <td>Druid Class'ı unlocklanır.</td>\r
        <td>Druidic, Vitamancy, Polymorph</td>\r
    </tr>\r
    <tr>\r
        <td>Becoming a Bard</td>\r
        <td>Bardlık öğretilir.</td>\r
        <td>Bard Class'ı unlocklanır.</td>\r
        <td>Music Arts, Performance Arts, Spectromancy</td>\r
    </tr>\r
    <tr>\r
        <td>Becoming an Alchemist</td>\r
        <td>Alchemistlik öğretilir.</td>\r
        <td>Alchemist sertifikası alınır.</td>\r
        <td>Herbology, Potiong Making, Polymorph</td>\r
    </tr>\r
    <tr>\r
        <td>Becoming an Artificier</td>\r
        <td>Artificerlık öğretilir.</td>\r
        <td>Artificer Class'ı unlocklanır.</td>\r
        <td>Arithmancy, Study of Ancient Runes</td>\r
    </tr>\r
    <tr>\r
        <td>Becoming a Faithful</td>\r
        <td>Dini roller öğretilir, Cleric, Paladin gibi.</td>\r
        <td>Dini Class'lar unlocklanır.</td>\r
        <td>Mythology, Study on Faith and Oaths, Divine Magic</td>\r
    </tr>\r
    <tr>\r
        <td></td>\r
        <td></td>\r
        <td></td>\r
        <td>-</td>\r
    </tr>\r
</tbody>\r
</table>\r
\r
proficiency bonus veren falan (mortal studies gibi) random seçmeliler ekleyip ekstra slotları harcamak için sebep verilmeli`;export{r as default};
